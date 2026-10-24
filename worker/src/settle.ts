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
