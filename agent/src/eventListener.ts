import { rpc } from '@stellar/stellar-sdk';
import { pool } from './db';
import { evaluateYield } from './yieldComparison';
import { processEventForAlerts } from './alertEngine';
import { AlertEventPayload, AlertEventType } from './alertEventPayload';
import logger from './logger';
import { withRetry } from './retry';
import { createLedgerCursorStore, EventPosition, initialPosition, isStalePositionError, LedgerCursor } from './ledgerCursor';
import { decodeVaultTransfer, vaultEventType } from './vaultEventPayload';
import { DEFAULT_STRATEGY, getCurrentAllocation, getUserStrategy } from './userStrategies';
import { submitRebalanceTx } from './sorobanTx';

export { pool };

const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
export const server = new rpc.Server(rpcUrl);

const VAULT_CONTRACT_ID = process.env.VAULT_CONTRACT_ID || '';
const EVENTS_PAGE_LIMIT = 100;

let eventInterval: ReturnType<typeof setInterval> | null = null;

export function stopEventListener() {
  if (eventInterval) {
    clearInterval(eventInterval);
    eventInterval = null;
    logger.info('Event listener stopped');
  }
}

/**
 * Listens for on-chain deposit and withdraw events from the vault contract.
 * Detects new deposits within 5 seconds and triggers yield deployment.
 */
export async function startEventListener() {
  if (!VAULT_CONTRACT_ID) {
    logger.warn('VAULT_CONTRACT_ID is not set. Event listener requires a contract ID to monitor.');
    return;
  }

  try {
    const latestLedgerResponse = await withRetry(
      () => server.getLatestLedger(),
      'getLatestLedger',
    );
    const cursor = new LedgerCursor(createLedgerCursorStore(pool));
    // If the saved cursor cannot be read we refuse to start rather than
    // silently skipping to the latest ledger.
    const stored = await withRetry(() => cursor.load(), 'loadLedgerCursor');
    let position: EventPosition = initialPosition(stored, latestLedgerResponse.sequence);
    if (stored) {
      logger.info({ pagingToken: stored.pagingToken, ledger: stored.ledger, latestLedger: latestLedgerResponse.sequence }, 'Resuming event listener from saved cursor');
    } else {
      logger.info({ startLedger: latestLedgerResponse.sequence }, 'Starting event listener from latest ledger (no saved cursor)');
    }

    const filters: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [VAULT_CONTRACT_ID] }];
    let polling = false;

    eventInterval = setInterval(async () => {
      // A slow poll must not overlap the next tick, or the same page would be
      // processed twice.
      if (polling) return;
      polling = true;
      try {
        let response: rpc.Api.GetEventsResponse;
        try {
          const request: rpc.Api.GetEventsRequest = 'cursor' in position
            ? { filters, cursor: position.cursor, limit: EVENTS_PAGE_LIMIT }
            : { filters, startLedger: position.startLedger, limit: EVENTS_PAGE_LIMIT };
          response = await withRetry(() => server.getEvents(request), 'getEvents');
        } catch (error) {
          if ('cursor' in position && isStalePositionError(error)) {
            const latest = await withRetry(() => server.getLatestLedger(), 'getLatestLedger');
            logger.error(
              { pagingToken: position.cursor, resumeLedger: latest.sequence, error: error instanceof Error ? error.message : error },
              'Saved event cursor is outside the RPC retention window; events in the gap were MISSED and need manual backfill',
            );
            position = { startLedger: latest.sequence };
          }
          throw error;
        }

        for (const event of response.events) {
          const eventType = vaultEventType(event.topic);

          if (eventType) {
            await handleVaultEvent(eventType, event);
          }

          // Event ids are paging tokens: persist after each event so a
          // restart resumes right after the last handled one.
          position = { cursor: event.id };
          await cursor.save(event.id, event.ledger);
        }

        // The page cursor also covers the scanned range with no matching
        // events, so idle periods are not rescanned after a restart.
        if (response.cursor) {
          position = { cursor: response.cursor };
          await cursor.save(response.cursor, response.latestLedger);
        }
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : error }, 'Error polling Soroban events');
      } finally {
        polling = false;
      }
    }, 5000);

  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error }, 'Failed to initialize event listener');
  }
}

async function handleVaultEvent(eventType: AlertEventType, event: rpc.Api.EventResponse) {
  logger.info({ eventType, ledger: event.ledger }, 'Detected event');

  await logEventToDb(eventType, event.id, event.ledger);

  const payload = decodeVaultTransfer(event);
  if (!payload) {
    logger.warn({ eventType, eventId: event.id }, 'Could not decode amount from vault event; skipping alert evaluation');
  }

  if (eventType === 'deposit') {
    logger.info('New deposit detected, evaluating yield');
    let userStrategy: string = DEFAULT_STRATEGY;
    let currentProtocol = 'none';
    let currentApy = 0;
    if (process.env.DATABASE_URL) {
      try {
        if (payload?.user) userStrategy = await getUserStrategy(pool, payload.user);
        ({ protocol: currentProtocol, apy: currentApy } = await getCurrentAllocation(pool));
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : error }, 'Failed to load user strategy; using defaults');
      }
    }

    // A yield-evaluation failure must not block alerting or stall the cursor
    // on this event forever.
    try {
      const decision = await evaluateYield(userStrategy, currentProtocol, currentApy);

      if (decision.shouldRebalance && decision.targetProtocol) {
        logger.info({ targetProtocol: decision.targetProtocol, userStrategy }, 'Rebalance needed');
        const expectedApy = currentApy; // use current evaluated APY or fetch it
        await submitRebalanceTx(decision.targetProtocol, expectedApy);
      }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : error, userStrategy }, 'Yield evaluation failed for deposit');
    }
  }

  if (payload) {
    const alertPayload: AlertEventPayload = {
      type: eventType,
      amount: payload.amount,
      user: payload.user,
      ledger: event.ledger,
    };
    await processEventForAlerts(alertPayload);
  }
}

async function logEventToDb(type: string, eventId: string, ledger: number) {
  try {
    if (process.env.DATABASE_URL) {
      await pool.query(
        'INSERT INTO vault_events (event_id, event_type, ledger_sequence, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
        [eventId, type, ledger]
      );
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error }, 'Database logging failed');
  }
}
