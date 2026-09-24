import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import logger from './logger';
import { processEventForAlerts } from './alertEngine';
import { parseAlertEventPayload } from './alertEventPayload';

describe('alert event schema', () => {
  it('rejects missing or incorrectly typed event types', () => {
    assert.deepStrictEqual(parseAlertEventPayload({ amount: 10, user: null, ledger: 1 }), {
      ok: false,
      reason: 'alert event payload requires a type',
    });
    assert.deepStrictEqual(parseAlertEventPayload({ type: 42, amount: 10, user: null, ledger: 1 }), {
      ok: false,
      reason: 'alert event payload requires a type',
    });
  });

  it('propagates amount into alert thresholds', async () => {
    const below = await processEventForAlerts({ type: 'withdraw', amount: 100_000, user: null, ledger: 10 });
    const above = await processEventForAlerts({ type: 'withdraw', amount: 250_000, user: null, ledger: 11 });

    assert.deepStrictEqual(below, []);
    assert.deepStrictEqual(above, ['TVL_ANOMALY', 'LARGE_WITHDRAWAL']);
  });

  it('drops unknown event types with a warning', async () => {
    const warning = mock.method(logger, 'warn', () => logger);
    const triggered = await processEventForAlerts({ type: 'mystery', amount: 250_000, user: null, ledger: 12 });

    assert.deepStrictEqual(triggered, []);
    assert.strictEqual(warning.mock.callCount(), 1);
    warning.mock.restore();
  });
});
