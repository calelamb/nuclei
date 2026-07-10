// ---------------------------------------------------------------------------
// Atomic, deterministic, serializable spend ledger for hardware submissions.
// Tracks a reserve → commit/release lifecycle so a submission's cost is
// carved out of the remaining budget BEFORE the submit port is called, and
// only actually spent once the provider confirms the job. Also tracks
// submission idempotency keys so the same logical submission is never sent
// twice.
// ---------------------------------------------------------------------------

export interface ReserveSuccess {
  ok: true;
  reservationId: string;
}

export interface ReserveFailure {
  ok: false;
  reason: string;
}

export type ReserveResult = ReserveSuccess | ReserveFailure;

export interface BudgetLedgerJSON {
  ceiling: number;
  spent: number;
  reserved: number;
  reservations: Array<[string, number]>;
  submittedKeys: Array<[string, string]>;
}

export class BudgetLedger {
  private readonly ceiling: number;
  private spent: number;
  private reserved: number;
  private readonly reservations: Map<string, number>;
  private readonly submittedKeys: Map<string, string>;
  private readonly idGen: () => string;

  constructor(ceiling: number, idGen?: () => string) {
    this.ceiling = ceiling;
    this.spent = 0;
    this.reserved = 0;
    this.reservations = new Map<string, number>();
    this.submittedKeys = new Map<string, string>();

    if (idGen) {
      this.idGen = idGen;
    } else {
      let counter = 0;
      this.idGen = () => `res_${++counter}`;
    }
  }

  /** Unreserved, unspent headroom remaining against the ceiling. */
  remaining(): number {
    return this.ceiling - this.spent - this.reserved;
  }

  /** Carves `amount` out of the remaining budget as a reservation. Fails
   * (without throwing) for a negative amount or when the reservation would
   * push spent + reserved past the ceiling. */
  reserve(amount: number): ReserveResult {
    if (amount < 0) {
      return { ok: false, reason: 'Reservation amount must be non-negative.' };
    }
    if (this.spent + this.reserved + amount > this.ceiling) {
      return { ok: false, reason: 'Insufficient remaining budget for this reservation.' };
    }

    const reservationId = this.idGen();
    this.reservations.set(reservationId, amount);
    this.reserved += amount;
    return { ok: true, reservationId };
  }

  /** Converts a reservation into actual spend. `actualCost` may differ from
   * the amount originally reserved (e.g. a provider's final invoice). Returns
   * false for an unknown or already-resolved reservation id. */
  commit(reservationId: string, actualCost: number): boolean {
    const amount = this.reservations.get(reservationId);
    if (amount === undefined) return false;

    this.reservations.delete(reservationId);
    this.reserved -= amount;
    this.spent += actualCost;
    return true;
  }

  /** Releases a reservation without spending it (e.g. the submission
   * failed). Returns false for an unknown or already-resolved reservation
   * id. */
  release(reservationId: string): boolean {
    const amount = this.reservations.get(reservationId);
    if (amount === undefined) return false;

    this.reservations.delete(reservationId);
    this.reserved -= amount;
    return true;
  }

  hasSubmitted(key: string): boolean {
    return this.submittedKeys.has(key);
  }

  recordSubmission(key: string, jobId: string): void {
    this.submittedKeys.set(key, jobId);
  }

  submittedJobId(key: string): string | undefined {
    return this.submittedKeys.get(key);
  }

  toJSON(): BudgetLedgerJSON {
    return {
      ceiling: this.ceiling,
      spent: this.spent,
      reserved: this.reserved,
      reservations: Array.from(this.reservations.entries()),
      submittedKeys: Array.from(this.submittedKeys.entries()),
    };
  }

  /** Rehydrates a ledger from a prior toJSON() snapshot. An idGen may be
   * supplied for deterministic tests; otherwise a fresh monotonic counter is
   * used for any reservations made after restoration. */
  static fromJSON(json: BudgetLedgerJSON, idGen?: () => string): BudgetLedger {
    const ledger = new BudgetLedger(json.ceiling, idGen);
    ledger.spent = json.spent;
    ledger.reserved = json.reserved;
    for (const [id, amount] of json.reservations) {
      ledger.reservations.set(id, amount);
    }
    for (const [key, jobId] of json.submittedKeys) {
      ledger.submittedKeys.set(key, jobId);
    }
    return ledger;
  }
}
