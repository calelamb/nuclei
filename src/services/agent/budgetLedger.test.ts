import { describe, expect, it } from 'vitest';
import { BudgetLedger } from './budgetLedger';

function makeIdGen(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}_${++counter}`;
}

describe('BudgetLedger', () => {
  it('starts with the full ceiling as remaining', () => {
    const ledger = new BudgetLedger(100);
    expect(ledger.remaining()).toBe(100);
  });

  it('reserve reduces remaining and returns a deterministic reservation id', () => {
    const ledger = new BudgetLedger(100, makeIdGen('res'));
    const result = ledger.reserve(30);
    expect(result).toEqual({ ok: true, reservationId: 'res_1' });
    expect(ledger.remaining()).toBe(70);
  });

  it('reserve fails for a negative amount without mutating state', () => {
    const ledger = new BudgetLedger(100);
    const result = ledger.reserve(-5);
    expect(result.ok).toBe(false);
    expect(ledger.remaining()).toBe(100);
  });

  it('reserve fails when it would push spent + reserved past the ceiling', () => {
    const ledger = new BudgetLedger(100);
    const first = ledger.reserve(80);
    expect(first.ok).toBe(true);
    const second = ledger.reserve(30);
    expect(second.ok).toBe(false);
    expect(ledger.remaining()).toBe(20);
  });

  it('reserve exactly up to the ceiling succeeds', () => {
    const ledger = new BudgetLedger(100);
    const result = ledger.reserve(100);
    expect(result.ok).toBe(true);
    expect(ledger.remaining()).toBe(0);
  });

  it('commit moves a reservation from reserved to spent', () => {
    const ledger = new BudgetLedger(100);
    const reservation = ledger.reserve(30);
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) throw new Error('unreachable');

    const committed = ledger.commit(reservation.reservationId, 25);
    expect(committed).toBe(true);
    // The reservation is released (30 freed) and the actual cost (25) spent,
    // so remaining reflects the true cost, not the original estimate.
    expect(ledger.remaining()).toBe(75);
  });

  it('commit on an unknown reservation id fails without mutating state', () => {
    const ledger = new BudgetLedger(100);
    const committed = ledger.commit('nope', 10);
    expect(committed).toBe(false);
    expect(ledger.remaining()).toBe(100);
  });

  it('commit on an already-committed reservation id fails (no double-spend)', () => {
    const ledger = new BudgetLedger(100);
    const reservation = ledger.reserve(30);
    if (!reservation.ok) throw new Error('unreachable');
    expect(ledger.commit(reservation.reservationId, 30)).toBe(true);
    expect(ledger.commit(reservation.reservationId, 30)).toBe(false);
    expect(ledger.remaining()).toBe(70);
  });

  it('release frees a reservation without touching spent', () => {
    const ledger = new BudgetLedger(100);
    const reservation = ledger.reserve(40);
    if (!reservation.ok) throw new Error('unreachable');
    const released = ledger.release(reservation.reservationId);
    expect(released).toBe(true);
    expect(ledger.remaining()).toBe(100);
  });

  it('release on an unknown reservation id fails', () => {
    const ledger = new BudgetLedger(100);
    expect(ledger.release('nope')).toBe(false);
  });

  it('a released reservation frees exactly its own budget, unaffected by other reservations', () => {
    const ledger = new BudgetLedger(100, makeIdGen('res'));
    const a = ledger.reserve(20);
    const b = ledger.reserve(30);
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(ledger.remaining()).toBe(50);
    ledger.release(a.reservationId);
    expect(ledger.remaining()).toBe(70);
  });

  it('idempotency: hasSubmitted/recordSubmission/submittedJobId round-trip', () => {
    const ledger = new BudgetLedger(100);
    expect(ledger.hasSubmitted('key-1')).toBe(false);
    expect(ledger.submittedJobId('key-1')).toBeUndefined();

    ledger.recordSubmission('key-1', 'job-abc');

    expect(ledger.hasSubmitted('key-1')).toBe(true);
    expect(ledger.submittedJobId('key-1')).toBe('job-abc');
    expect(ledger.hasSubmitted('key-2')).toBe(false);
  });

  it('toJSON/fromJSON round-trips ceiling, spent, reserved, reservations, and submissions', () => {
    const ledger = new BudgetLedger(100, makeIdGen('res'));
    const reservation = ledger.reserve(20);
    if (!reservation.ok) throw new Error('unreachable');
    ledger.recordSubmission('key-1', 'job-abc');

    const snapshot = ledger.toJSON();
    expect(snapshot).toEqual({
      ceiling: 100,
      spent: 0,
      reserved: 20,
      reservations: [['res_1', 20]],
      submittedKeys: [['key-1', 'job-abc']],
    });

    const restored = BudgetLedger.fromJSON(snapshot, makeIdGen('res'));
    expect(restored.remaining()).toBe(80);
    expect(restored.hasSubmitted('key-1')).toBe(true);
    expect(restored.submittedJobId('key-1')).toBe('job-abc');

    // The restored reservation can still be committed/released by its
    // original id.
    expect(restored.commit('res_1', 20)).toBe(true);
    expect(restored.remaining()).toBe(80);
  });

  it('fromJSON restores a ledger that can continue making new reservations', () => {
    const ledger = new BudgetLedger(50);
    const snapshot = ledger.toJSON();
    const restored = BudgetLedger.fromJSON(snapshot, makeIdGen('post'));
    const result = restored.reserve(10);
    expect(result).toEqual({ ok: true, reservationId: 'post_1' });
    expect(restored.remaining()).toBe(40);
  });
});
