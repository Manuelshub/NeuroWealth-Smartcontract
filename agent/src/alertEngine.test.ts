/**
 * Unit tests for alertEngine.ts (Issue #690)
 *
 * alertEngine.ts has no external SDK dependencies, so we import it directly
 * and intercept delivery channels by spying on console.log (which is what
 * the mock channel functions delegate to).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  alertRules,
  processEventForAlerts,
  type AlertRule,
} from './alertEngine';

// ---------------------------------------------------------------------------
// Console capture – intercept console.log so we can assert on delivery calls
// without producing noise in the test output.
// ---------------------------------------------------------------------------

let logLines: string[] = [];
const originalLog = console.log;

function captureLog() {
  logLines = [];
  console.log = (...args: unknown[]) => {
    logLines.push(args.map(String).join(' '));
  };
}

function restoreLog() {
  console.log = originalLog;
}

// ---------------------------------------------------------------------------
// Helper – build a minimal event object
// ---------------------------------------------------------------------------

interface TestEvent {
  type: string;
  amount: number;
  rawAmount: string;
  user: string;
  eventId: string;
  ledger: number;
}

function makeEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    type: 'deposit',
    amount: 1000,
    rawAmount: '10000000000',
    user: 'GABC1234',
    eventId: 'evt-001',
    ledger: 5000,
    ...overrides,
  };
}

// The mock vault state used inside alertEngine is hardcoded to totalAssets = 1_000_000.
const TOTAL_ASSETS = 1_000_000;

// ---------------------------------------------------------------------------
// Suite 1 – Alert rule definitions
// ---------------------------------------------------------------------------

describe('alertEngine – alert rule definitions', () => {
  it('exports a non-empty alertRules array', () => {
    assert.ok(Array.isArray(alertRules));
    assert.ok(alertRules.length > 0);
  });

  it('every rule has required fields: name, description, check, severity', () => {
    for (const rule of alertRules) {
      assert.ok(typeof rule.name === 'string' && rule.name.length > 0,
        `rule ${rule.name} missing name`);
      assert.ok(typeof rule.description === 'string' && rule.description.length > 0,
        `rule ${rule.name} missing description`);
      assert.ok(typeof rule.check === 'function',
        `rule ${rule.name} missing check function`);
      assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(rule.severity),
        `rule ${rule.name} has invalid severity: ${rule.severity}`);
    }
  });

  it('includes TVL_ANOMALY, LARGE_WITHDRAWAL, and AUTH_FAILURE rules', () => {
    const names = alertRules.map((r) => r.name);
    assert.ok(names.includes('TVL_ANOMALY'), 'missing TVL_ANOMALY rule');
    assert.ok(names.includes('LARGE_WITHDRAWAL'), 'missing LARGE_WITHDRAWAL rule');
    assert.ok(names.includes('AUTH_FAILURE'), 'missing AUTH_FAILURE rule');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Alert triggering conditions
// ---------------------------------------------------------------------------

describe('alertEngine – alert triggering conditions', () => {
  const state = { totalAssets: TOTAL_ASSETS };

  it('TVL_ANOMALY fires when a withdrawal exceeds 20% of total assets', () => {
    const rule = alertRules.find((r) => r.name === 'TVL_ANOMALY')!;
    const bigWithdraw = makeEvent({ type: 'withdraw', amount: TOTAL_ASSETS * 0.21 });
    assert.strictEqual(rule.check(bigWithdraw, state), true);
  });

  it('TVL_ANOMALY does not fire when withdrawal is exactly 20% of total assets', () => {
    const rule = alertRules.find((r) => r.name === 'TVL_ANOMALY')!;
    const exactWithdraw = makeEvent({ type: 'withdraw', amount: TOTAL_ASSETS * 0.2 });
    // 200000 > 200000 is false – boundary is exclusive
    assert.strictEqual(rule.check(exactWithdraw, state), false);
  });

  it('TVL_ANOMALY does not fire for a deposit even if large', () => {
    const rule = alertRules.find((r) => r.name === 'TVL_ANOMALY')!;
    const bigDeposit = makeEvent({ type: 'deposit', amount: TOTAL_ASSETS });
    assert.strictEqual(rule.check(bigDeposit, state), false);
  });

  it('LARGE_WITHDRAWAL fires when withdrawal amount exceeds 100,000', () => {
    const rule = alertRules.find((r) => r.name === 'LARGE_WITHDRAWAL')!;
    const event = makeEvent({ type: 'withdraw', amount: 100_001 });
    assert.strictEqual(rule.check(event, state), true);
  });

  it('LARGE_WITHDRAWAL does not fire when withdrawal is exactly 100,000', () => {
    const rule = alertRules.find((r) => r.name === 'LARGE_WITHDRAWAL')!;
    const event = makeEvent({ type: 'withdraw', amount: 100_000 });
    assert.strictEqual(rule.check(event, state), false);
  });

  it('LARGE_WITHDRAWAL does not fire for a large deposit', () => {
    const rule = alertRules.find((r) => r.name === 'LARGE_WITHDRAWAL')!;
    const event = makeEvent({ type: 'deposit', amount: 500_000 });
    assert.strictEqual(rule.check(event, state), false);
  });

  it('AUTH_FAILURE fires for an auth_failure event type', () => {
    const rule = alertRules.find((r) => r.name === 'AUTH_FAILURE')!;
    const event = makeEvent({ type: 'auth_failure', amount: 0 });
    assert.strictEqual(rule.check(event, state), true);
  });

  it('AUTH_FAILURE does not fire for deposit events', () => {
    const rule = alertRules.find((r) => r.name === 'AUTH_FAILURE')!;
    const event = makeEvent({ type: 'deposit', amount: 100 });
    assert.strictEqual(rule.check(event, state), false);
  });

  it('AUTH_FAILURE does not fire for withdraw events', () => {
    const rule = alertRules.find((r) => r.name === 'AUTH_FAILURE')!;
    const event = makeEvent({ type: 'withdraw', amount: 50 });
    assert.strictEqual(rule.check(event, state), false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Alert delivery (mocked via console capture)
// ---------------------------------------------------------------------------

describe('alertEngine – alert delivery', () => {
  beforeEach(captureLog);
  afterEach(restoreLog);

  it('sends email, telegram and discord for a LARGE_WITHDRAWAL event', async () => {
    await processEventForAlerts(makeEvent({ type: 'withdraw', amount: 200_000 }));

    assert.ok(logLines.some((l) => l.includes('Email sent')),
      'email delivery expected');
    assert.ok(logLines.some((l) => l.includes('Telegram message sent')),
      'telegram delivery expected');
    assert.ok(logLines.some((l) => l.includes('Discord webhook sent')),
      'discord delivery expected');
  });

  it('additionally sends PagerDuty for a CRITICAL alert (TVL_ANOMALY)', async () => {
    // Withdraw > 20% of totalAssets (1_000_000) → CRITICAL
    await processEventForAlerts(makeEvent({ type: 'withdraw', amount: 300_000 }));

    assert.ok(logLines.some((l) => l.includes('PagerDuty incident created')),
      'PagerDuty delivery expected for CRITICAL severity');
  });

  it('does NOT send PagerDuty for a HIGH alert (LARGE_WITHDRAWAL only)', async () => {
    // 150_000 > 100_000 → LARGE_WITHDRAWAL (HIGH) fires
    // but 150_000 / 1_000_000 = 15% which is NOT > 20% → TVL_ANOMALY (CRITICAL) does NOT fire
    await processEventForAlerts(makeEvent({ type: 'withdraw', amount: 150_000 }));

    assert.ok(!logLines.some((l) => l.includes('PagerDuty incident created')),
      'PagerDuty should NOT fire for HIGH severity only');
  });

  it('logs the alert header with severity and rule name', async () => {
    await processEventForAlerts(makeEvent({ type: 'auth_failure', amount: 0 }));

    assert.ok(logLines.some((l) => l.includes('[ALERT]') && l.includes('AUTH_FAILURE')),
      'alert header with rule name expected');
    assert.ok(logLines.some((l) => l.includes('[MEDIUM]')),
      'severity label expected in alert header');
  });

  it('triggers no alerts for a normal small deposit', async () => {
    await processEventForAlerts(makeEvent({ type: 'deposit', amount: 100 }));

    assert.ok(!logLines.some((l) => l.includes('[ALERT]')),
      'no alert expected for a normal deposit');
  });

  it('triggers no alerts for a small withdrawal below all thresholds', async () => {
    await processEventForAlerts(makeEvent({ type: 'withdraw', amount: 500 }));

    assert.ok(!logLines.some((l) => l.includes('[ALERT]')),
      'no alert expected for a small withdrawal');
  });
});

// ---------------------------------------------------------------------------
// Suite 4 – Alert deduplication (multiple rules can match the same event)
// ---------------------------------------------------------------------------

describe('alertEngine – alert deduplication / multi-rule matching', () => {
  beforeEach(captureLog);
  afterEach(restoreLog);

  it('fires both TVL_ANOMALY and LARGE_WITHDRAWAL for a very large withdrawal', async () => {
    // 300_000 > 100_000 (LARGE_WITHDRAWAL) AND > 20% of 1_000_000 (TVL_ANOMALY)
    await processEventForAlerts(makeEvent({ type: 'withdraw', amount: 300_000 }));

    const alertHeaders = logLines.filter((l) => l.includes('[ALERT]'));
    const names = alertHeaders.map((l) => l);
    assert.ok(names.some((l) => l.includes('TVL_ANOMALY')),
      'TVL_ANOMALY should fire');
    assert.ok(names.some((l) => l.includes('LARGE_WITHDRAWAL')),
      'LARGE_WITHDRAWAL should fire');
  });

  it('each matched rule triggers its own delivery chain independently', async () => {
    await processEventForAlerts(makeEvent({ type: 'withdraw', amount: 300_000 }));

    // TVL_ANOMALY (CRITICAL) → email + telegram + discord + PagerDuty
    // LARGE_WITHDRAWAL (HIGH) → email + telegram + discord
    // So "Email sent" should appear at least twice
    const emailLines = logLines.filter((l) => l === 'Email sent');
    assert.ok(emailLines.length >= 2,
      `email should be sent for each matched rule, got ${emailLines.length}`);
  });

  it('same event processed twice fires alerts both times (no cross-call deduplication)', async () => {
    const event = makeEvent({ type: 'withdraw', amount: 300_000 });
    await processEventForAlerts(event);
    const firstRunAlerts = logLines.filter((l) => l.includes('[ALERT]')).length;

    logLines = []; // reset capture between calls
    await processEventForAlerts(event);
    const secondRunAlerts = logLines.filter((l) => l.includes('[ALERT]')).length;

    assert.strictEqual(firstRunAlerts, secondRunAlerts,
      'alert count should be identical on repeated processing of the same event');
  });
});

// ---------------------------------------------------------------------------
// Suite 5 – Alert severity levels
// ---------------------------------------------------------------------------

describe('alertEngine – alert severity levels', () => {
  it('TVL_ANOMALY has CRITICAL severity', () => {
    const rule = alertRules.find((r) => r.name === 'TVL_ANOMALY')!;
    assert.strictEqual(rule.severity, 'CRITICAL');
  });

  it('LARGE_WITHDRAWAL has HIGH severity', () => {
    const rule = alertRules.find((r) => r.name === 'LARGE_WITHDRAWAL')!;
    assert.strictEqual(rule.severity, 'HIGH');
  });

  it('AUTH_FAILURE has MEDIUM severity', () => {
    const rule = alertRules.find((r) => r.name === 'AUTH_FAILURE')!;
    assert.strictEqual(rule.severity, 'MEDIUM');
  });

  it('every severity value is one of LOW | MEDIUM | HIGH | CRITICAL', () => {
    const valid = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    for (const rule of alertRules) {
      assert.ok(valid.has(rule.severity),
        `unexpected severity "${rule.severity}" on rule "${rule.name}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 6 – Alert acknowledgment (rule.check return value semantics)
// ---------------------------------------------------------------------------

describe('alertEngine – alert acknowledgment / check return semantics', () => {
  const state = { totalAssets: TOTAL_ASSETS };

  it('rule.check returns a boolean (not truthy/falsy)', () => {
    for (const rule of alertRules) {
      const event = makeEvent();
      const result = rule.check(event, state);
      assert.strictEqual(typeof result, 'boolean',
        `rule ${rule.name} check() should return a strict boolean`);
    }
  });

  it('a rule that does not match returns exactly false', () => {
    const rule = alertRules.find((r) => r.name === 'AUTH_FAILURE')!;
    const result = rule.check(makeEvent({ type: 'deposit' }), state);
    assert.strictEqual(result, false);
  });

  it('a rule that matches returns exactly true', () => {
    const rule = alertRules.find((r) => r.name === 'AUTH_FAILURE')!;
    const result = rule.check(makeEvent({ type: 'auth_failure', amount: 0 }), state);
    assert.strictEqual(result, true);
  });

  it('processEventForAlerts resolves without throwing for any valid event type', async () => {
    for (const type of ['deposit', 'withdraw', 'auth_failure', 'unknown']) {
      await assert.doesNotReject(
        () => processEventForAlerts(makeEvent({ type, amount: 0 })),
        `processEventForAlerts should not throw for event type "${type}"`,
      );
    }
  });
});
