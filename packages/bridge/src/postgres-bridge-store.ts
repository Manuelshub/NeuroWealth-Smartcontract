/**
 * PostgreSQL-backed BridgeStore implementation (#809)
 *
 * Uses the schema.sql tables for durable storage of bridge transfers.
 * Replaces InMemoryBridgeStore for production deployments.
 */

import pino from "pino";
import { Pool, PoolClient } from "pg";
import { BridgeStore } from "./bridge-store";
import { StoredBridgeTransfer } from "./types";

export interface PostgresBridgeStoreConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
}

export class PostgresBridgeStore implements BridgeStore {
  private logger = pino();
  private pool: Pool;

  constructor(config: PostgresBridgeStoreConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections ?? 10,
      idleTimeoutMs: config.idleTimeoutMs ?? 30000,
    });

    this.pool.on("error", (err) => {
      this.logger.error({ err }, "Unexpected PostgreSQL pool error");
    });
  }

  async save(transfer: StoredBridgeTransfer): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO bridge_transfers (
          id, status, direction, source_chain, destination_chain,
          user_address, ethereum_user_address, stellar_user_address,
          amount, bridge_fee, net_amount,
          source_chain_tx_hash, bridge_tx_hash, destination_tx_hash,
          created_at, updated_at, estimated_arrival_time,
          retries_remaining, last_retry_time, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          transfer.id,
          transfer.status,
          transfer.direction,
          transfer.sourceChain,
          transfer.destinationChain,
          transfer.user,
          transfer.ethereumUserAddress ?? null,
          transfer.stellarUserAddress ?? null,
          transfer.amount,
          transfer.bridgeFee,
          transfer.netAmount,
          transfer.sourceChainTxHash ?? null,
          transfer.bridgeTxHash ?? null,
          transfer.destinationTxHash ?? null,
          new Date(transfer.createdAt),
          new Date(transfer.updatedAt),
          transfer.estimatedArrivalTime ? new Date(transfer.estimatedArrivalTime) : null,
          transfer.retriesRemaining ?? 3,
          transfer.lastRetryTime ? new Date(transfer.lastRetryTime) : null,
          transfer.errorMessage ?? null,
        ],
      );
      this.logger.debug({ transferId: transfer.id }, "Transfer saved to PostgreSQL");
    } finally {
      client.release();
    }
  }

  async get(transferId: string): Promise<StoredBridgeTransfer | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT * FROM bridge_transfers WHERE id = $1",
        [transferId],
      );

      if (result.rows.length === 0) return null;

      return this.mapRowToTransfer(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getPending(): Promise<StoredBridgeTransfer[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT * FROM bridge_transfers WHERE status IN ('pending', 'confirming') ORDER BY created_at ASC",
      );

      return result.rows.map((row) => this.mapRowToTransfer(row));
    } finally {
      client.release();
    }
  }

  async getByUser(userAddress: string): Promise<StoredBridgeTransfer[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT * FROM bridge_transfers WHERE LOWER(user_address) = LOWER($1) ORDER BY created_at DESC",
        [userAddress],
      );

      return result.rows.map((row) => this.mapRowToTransfer(row));
    } finally {
      client.release();
    }
  }

  async update(
    transferId: string,
    updates: Partial<StoredBridgeTransfer>,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (updates.status !== undefined) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }
      if (updates.sourceChainTxHash !== undefined) {
        setClauses.push(`source_chain_tx_hash = $${paramIndex++}`);
        values.push(updates.sourceChainTxHash);
      }
      if (updates.bridgeTxHash !== undefined) {
        setClauses.push(`bridge_tx_hash = $${paramIndex++}`);
        values.push(updates.bridgeTxHash);
      }
      if (updates.destinationChainTxHash !== undefined) {
        setClauses.push(`destination_tx_hash = $${paramIndex++}`);
        values.push(updates.destinationChainTxHash);
      }
      if (updates.errorMessage !== undefined) {
        setClauses.push(`error_message = $${paramIndex++}`);
        values.push(updates.errorMessage);
      }
      if (updates.retriesRemaining !== undefined) {
        setClauses.push(`retries_remaining = $${paramIndex++}`);
        values.push(updates.retriesRemaining);
      }
      if (updates.lastRetryTime !== undefined) {
        setClauses.push(`last_retry_time = $${paramIndex++}`);
        values.push(new Date(updates.lastRetryTime));
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(transferId);

      await client.query(
        `UPDATE bridge_transfers SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
        values,
      );

      this.logger.debug({ transferId }, "Transfer updated in PostgreSQL");
    } finally {
      client.release();
    }
  }

  async delete(transferId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("DELETE FROM bridge_transfers WHERE id = $1", [transferId]);
      this.logger.debug({ transferId }, "Transfer deleted from PostgreSQL");
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapRowToTransfer(row: Record<string, unknown>): StoredBridgeTransfer {
    return {
      id: row.id as string,
      status: row.status as StoredBridgeTransfer["status"],
      direction: row.direction as StoredBridgeTransfer["direction"],
      sourceChain: row.source_chain as StoredBridgeTransfer["sourceChain"],
      destinationChain: row.destination_chain as StoredBridgeTransfer["destinationChain"],
      user: row.user_address as string,
      ethereumUserAddress: row.ethereum_user_address as string | undefined,
      stellarUserAddress: row.stellar_user_address as string | undefined,
      amount: Number(row.amount),
      bridgeFee: Number(row.bridge_fee),
      netAmount: Number(row.net_amount),
      sourceChainTxHash: row.source_chain_tx_hash as string | undefined,
      bridgeTxHash: row.bridge_tx_hash as string | undefined,
      destinationChainTxHash: row.destination_tx_hash as string | undefined,
      createdAt: new Date(row.created_at as string).getTime(),
      updatedAt: new Date(row.updated_at as string).getTime(),
      estimatedArrivalTime: row.estimated_arrival_time
        ? new Date(row.estimated_arrival_time as string).getTime()
        : undefined,
      retriesRemaining: row.retries_remaining as number,
      lastRetryTime: row.last_retry_time
        ? new Date(row.last_retry_time as string).getTime()
        : undefined,
      errorMessage: row.error_message as string | undefined,
    };
  }
}
