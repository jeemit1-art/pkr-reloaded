import type { Transfer } from './types';

/**
 * Produce transfers for a balanced game, in integer cents.
 *
 * Never silently modify a player's net result to force an unbalanced game
 * to reconcile. The host must correct buy-ins or cash-outs first.
 */
export function minimumTransfers(
  positions: Array<{ user_id: string; display_name: string; net: number }>
): Transfer[] {
  const seen = new Set<string>();
  let variance = 0;
  for (const p of positions) {
    if (typeof p.user_id !== 'string' || !p.user_id.trim() ||
        typeof p.display_name !== 'string' || !p.display_name.trim() ||
        !Number.isSafeInteger(p.net)) {
      throw new Error('Settlement requires valid player IDs, names and integer-cent balances');
    }
    if (seen.has(p.user_id)) {
      throw new Error('Settlement contains duplicate player IDs');
    }
    seen.add(p.user_id);
    variance += p.net;
    if (!Number.isSafeInteger(variance)) {
      throw new Error('Settlement balances exceed safe integer-cent precision');
    }
  }
  if (variance !== 0) {
    throw new Error('Unbalanced settlement: buy-ins and cash-outs must match exactly');
  }

  const credits = positions.filter(p => p.net > 0).map(p => ({ ...p, bal: p.net }));
  const debts = positions.filter(p => p.net < 0).map(p => ({ ...p, bal: -p.net }));
  credits.sort((a, b) => b.bal - a.bal);
  debts.sort((a, b) => b.bal - a.bal);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debts.length && j < credits.length) {
    const amount = Math.min(debts[i].bal, credits[j].bal);
    if (amount > 0) {
      transfers.push({
        from: debts[i].user_id,
        from_name: debts[i].display_name,
        to: credits[j].user_id,
        to_name: credits[j].display_name,
        amount,
      });
    }
    debts[i].bal -= amount;
    credits[j].bal -= amount;
    if (debts[i].bal === 0) i++;
    if (credits[j].bal === 0) j++;
  }
  return transfers;
}


export interface SettlementPlayerInput {
  user_id: string;
  display_name: string;
  buy_ins: number;
  buy_in_total?: number | null;
  cashout: number;
  whatsapp?: string;
}

export interface SettlementPosition extends Omit<SettlementPlayerInput, 'buy_in_total'> {
  buy_in_total: number;
  net: number;
}

export class SettlementValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 422 = 400,
    public readonly detail?: { total_buyins: number; total_cashouts: number; variance: number },
  ) {
    super(message);
    this.name = 'SettlementValidationError';
  }
}

/** Validate inputs and reconcile totals before any financial DB mutation. */
export function prepareSettlementPositions(
  raw: unknown,
  eventBuyIn: number,
): { positions: SettlementPosition[]; total_buyins: number; total_cashouts: number; variance: number } {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 100) {
    throw new SettlementValidationError('Settlement requires 2 to 100 players');
  }
  if (!Number.isSafeInteger(eventBuyIn) || eventBuyIn < 0) {
    throw new SettlementValidationError('Invalid event buy-in configuration');
  }

  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  let total_buyins = 0;
  let total_cashouts = 0;
  const positions: SettlementPosition[] = [];

  for (const input of raw) {
    if (!input || typeof input !== 'object') {
      throw new SettlementValidationError('Invalid player record');
    }
    const p = input as Record<string, unknown>;
    const name = typeof p.display_name === 'string' ? p.display_name.trim() : '';
    const id = typeof p.user_id === 'string' ? p.user_id.trim() : '';
    if (!name || name.length > 120 || !id || id.length > 256) {
      throw new SettlementValidationError('Player name and ID are required');
    }
    const nameKey = name.toLocaleLowerCase('en');
    if (seenNames.has(nameKey) || seenIds.has(id)) {
      throw new SettlementValidationError('Duplicate player in settlement');
    }
    seenNames.add(nameKey);
    seenIds.add(id);

    const count = p.buy_ins;
    const cashout = p.cashout;
    const explicitBuyin = p.buy_in_total;
    if (!Number.isSafeInteger(count) || (count as number) < 1 ||
        !Number.isSafeInteger(cashout) || (cashout as number) < 0 ||
        (explicitBuyin != null &&
          (!Number.isSafeInteger(explicitBuyin) || (explicitBuyin as number) < 0))) {
      throw new SettlementValidationError('Buy-in counts and money must be non-negative integer cents');
    }

    // The event default is a legacy fallback when no explicit buy-in amount was provided.
    const invested = typeof explicitBuyin === 'number' && explicitBuyin > 0
      ? explicitBuyin
      : (count as number) * eventBuyIn;
    const net = (cashout as number) - invested;
    total_buyins += invested;
    total_cashouts += cashout as number;
    if (![invested, net, total_buyins, total_cashouts].every(Number.isSafeInteger)) {
      throw new SettlementValidationError('Settlement amounts exceed safe integer-cent precision');
    }
    positions.push({
      user_id: id,
      display_name: name,
      buy_ins: count as number,
      buy_in_total: invested,
      cashout: cashout as number,
      whatsapp: typeof p.whatsapp === 'string' ? p.whatsapp : undefined,
      net,
    });
  }

  const variance = total_cashouts - total_buyins;
  if (!Number.isSafeInteger(variance)) {
    throw new SettlementValidationError('Settlement variance exceeds safe integer-cent precision');
  }
  if (variance !== 0) {
    throw new SettlementValidationError(
      'Cannot settle an unbalanced game. Correct buy-ins or cash-outs first.',
      422,
      { total_buyins, total_cashouts, variance },
    );
  }

  return { positions, total_buyins, total_cashouts, variance };
}
