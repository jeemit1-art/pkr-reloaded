/**
 * Persist side-pot winner allocations in the existing hand_results.hole_cards
 * JSON object, without requiring a schema migration on live game histories.
 * Old records remain readable. The reserved metadata key is excluded from
 * all normal hole-card API responses.
 */
const allocationKey = '__pkr_hand_pot_allocations_v1';
const refundsKey = '__pkr_uncalled_bet_returns_v1';

export interface HandPotAllocation {
  potIdx: number;
  winnerName: string;
  chips: number;
  label: string;
}

export class HandResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandResultError';
  }
}

export function serializeHandCards(
  holeCards: unknown,
  rawAllocations: unknown,
  handPotChips: number,
  uncalledReturns: unknown = [],
): string {
  if (!holeCards || typeof holeCards !== 'object' || Array.isArray(holeCards)) {
    holeCards = {};
  }
  const cards = {...(holeCards as Record<string,unknown>)};
  if (Object.prototype.hasOwnProperty.call(cards, allocationKey) ||
      Object.prototype.hasOwnProperty.call(cards, refundsKey)) {
    throw new HandResultError('Reserved hand metadata field cannot appear in hole cards');
  }
  if(!Array.isArray(uncalledReturns)||uncalledReturns.length>1 ||
     uncalledReturns.some(row=>
       !row||typeof row!=='object'||
       typeof row.display_name!=='string'||!row.display_name.trim()||
       !Number.isSafeInteger(row.chips)||row.chips<=0))
    throw new HandResultError('Uncalled-bet returns must be derived from verified hand actions');
  const refunds=uncalledReturns as Array<{display_name:string;chips:number}>;
  const refunded=refunds.reduce((n,r)=>n+r.chips,0);
  if(!Number.isSafeInteger(refunded)||refunded>handPotChips)
    throw new HandResultError('Uncalled-bet refund is greater than the recorded pot');
  if (refunds.length) cards[refundsKey]=refunds;
  if (rawAllocations === undefined) return JSON.stringify(cards);

  if (!Array.isArray(rawAllocations) ||
      rawAllocations.length < 1 || rawAllocations.length > 20 ||
      !Number.isSafeInteger(handPotChips) || handPotChips < 0) {
    throw new HandResultError('Invalid side-pot allocations');
  }
  const allocations: HandPotAllocation[] = [];
  let total = 0;
  const indices = new Set<number>();
  for (const item of rawAllocations) {
    if (!item || typeof item !== 'object') {
      throw new HandResultError('Invalid side-pot winner');
    }
    const row = item as Record<string,unknown>;
    const potIdx = row.potIdx;
    const chips = row.chips;
    const winnerName = typeof row.winnerName === 'string' ? row.winnerName.trim() : '';
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!Number.isSafeInteger(potIdx) || (potIdx as number) < 0 ||
        indices.has(potIdx as number) ||
        !Number.isSafeInteger(chips) || (chips as number) <= 0 ||
        !winnerName || winnerName.length > 200 || !label || label.length > 80) {
      throw new HandResultError('Side-pot winner, index and chips must be valid');
    }
    indices.add(potIdx as number);
    total += chips as number;
    if (!Number.isSafeInteger(total)) {
      throw new HandResultError('Side-pot allocations exceed integer chip precision');
    }
    allocations.push({
      potIdx:potIdx as number,winnerName,chips:chips as number,label,
    });
  }
  allocations.sort((a,b)=>a.potIdx-b.potIdx);
  if (allocations.some((p,i)=>p.potIdx!==i)) {
    throw new HandResultError('Side-pot allocations must have consecutive indices');
  }
  if (total + refunded !== handPotChips) {
    throw new HandResultError('Pot winners plus uncalled-bet refunds must account for every recorded chip');
  }

  cards[allocationKey] = allocations;
  return JSON.stringify(cards);
}

export function revealHandPotAllocations<T extends Record<string, any> | null>(row:T): T {
  if (!row || typeof row.hole_cards !== 'string') return row;
  try {
    const cards: unknown = JSON.parse(row.hole_cards);
    if (!cards || typeof cards !== 'object' || Array.isArray(cards) ||
        (!Object.prototype.hasOwnProperty.call(cards,allocationKey) &&
         !Object.prototype.hasOwnProperty.call(cards,refundsKey))) {
      return row;
    }
    const data = {...(cards as Record<string,unknown>)};
    const allocations = data[allocationKey];
    const refunds = data[refundsKey];
    delete data[allocationKey];
    delete data[refundsKey];
    return {...row,hole_cards:JSON.stringify(data),
      ...(Array.isArray(allocations)?{pot_winners:allocations}:{}),
      ...(Array.isArray(refunds)?{uncalled_returns:refunds}:{}),
    } as T;
  } catch {
    // Legacy records can contain imperfect JSON; never break the hand history.
    return row;
  }
}
