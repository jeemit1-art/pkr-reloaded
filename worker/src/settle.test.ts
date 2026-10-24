import { describe, it, expect } from 'vitest';
import { minimumTransfers, prepareSettlementPositions, SettlementValidationError } from './settle';

type Pos = { user_id: string; display_name: string; net: number };
const P = (name: string, net: number): Pos => ({ user_id: name, display_name: name, net });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function moved(positions: Pos[], transfers: ReturnType<typeof minimumTransfers>) {
  const m: Record<string, { paid: number; got: number }> = {};
  positions.forEach(p => { m[p.user_id] = { paid: 0, got: 0 }; });
  transfers.forEach(t => { m[t.from].paid += t.amount; m[t.to].got += t.amount; });
  return m;
}

describe('minimumTransfers — financial integrity', () => {
  it('returns nothing for empty or all-zero input', () => {
    expect(minimumTransfers([])).toEqual([]);
    expect(minimumTransfers([P('A', 0), P('B', 0)])).toEqual([]);
  });

  it('settles a balanced table exactly in integer cents', () => {
    const pos = [P('A', 10000), P('B', -6000), P('C', -4000)];
    const m = moved(pos, minimumTransfers(pos));
    pos.forEach(p => expect(m[p.user_id].got - m[p.user_id].paid).toBe(p.net));
  });

  it('matches the first staging game: Alex pays Charlie $10', () => {
    expect(minimumTransfers([P('Alex', -1000), P('Ben', 0), P('Charlie', 1000)])).toEqual([
      { from: 'Alex', from_name: 'Alex', to: 'Charlie', to_name: 'Charlie', amount: 1000 },
    ]);
  });

  it('matches a balanced rebuy game with two creditors', () => {
    const t = minimumTransfers([P('Alex', -2500), P('Ben', 1000), P('Charlie', 1500)]);
    expect(t).toEqual([
      { from: 'Alex', from_name: 'Alex', to: 'Charlie', to_name: 'Charlie', amount: 1500 },
      { from: 'Alex', from_name: 'Alex', to: 'Ben', to_name: 'Ben', amount: 1000 },
    ]);
  });

  it('rejects both directions of unbalanced totals rather than silently changing payouts', () => {
    expect(() => minimumTransfers([P('A', 10000), P('B', -4000)])).toThrow(/Unbalanced settlement/);
    expect(() => minimumTransfers([P('A', 4000), P('B', -6000), P('C', -4000)])).toThrow(/Unbalanced settlement/);
    expect(() => minimumTransfers([P('A', 1000)])).toThrow(/Unbalanced settlement/);
  });

  it('rejects fractional cents, unsafe numbers, and duplicate IDs', () => {
    expect(() => minimumTransfers([P('A', 0.5), P('B', -0.5)])).toThrow(/integer-cent/);
    expect(() => minimumTransfers([P('A', Number.POSITIVE_INFINITY), P('B', 0)])).toThrow(/integer-cent/);
    expect(() => minimumTransfers([P('A', 0), P('A', 0)])).toThrow(/duplicate player IDs/);
    expect(() => minimumTransfers([P('A', Number.MAX_SAFE_INTEGER), P('B', Number.MAX_SAFE_INTEGER)])).toThrow(/precision/);
  });

  it('random tables: exact conservation or rejection, never altered balances', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let iter = 0; iter < 300; iter++) {
      const n = 2 + Math.floor(rnd() * 8);
      const nets = Array.from({ length: n }, () => Math.round((rnd() - 0.5) * 40000 / 25) * 25);
      if (iter % 2 === 0) nets[n - 1] -= sum(nets);
      const pos = nets.map((x, i) => P('P' + i, x));
      const original = pos.map(p => ({ ...p }));
      if (sum(nets) !== 0) {
        expect(() => minimumTransfers(pos)).toThrow(/Unbalanced settlement/);
      } else {
        const t = minimumTransfers(pos);
        const m = moved(pos, t);
        t.forEach(x => {
          expect(x.amount).toBeGreaterThan(0);
          expect(Number.isSafeInteger(x.amount)).toBe(true);
          expect(x.from).not.toBe(x.to);
        });
        expect(t.length).toBeLessThanOrEqual(n - 1);
        pos.forEach(p => expect(m[p.user_id].got - m[p.user_id].paid).toBe(p.net));
      }
      expect(pos).toEqual(original);
    }
  });
});


const Player = (name: string, buy_ins: number, buy_in_total: number, cashout: number) => ({
  user_id: name, display_name: name, buy_ins, buy_in_total, cashout,
});

describe('prepareSettlementPositions — API safety gates', () => {
  it('preserves the proven balanced staging game exactly', () => {
    const raw = [Player('Alex',1,2000,1000),Player('Ben',1,2000,2000),Player('Charlie',1,2000,3000)];
    const snapshot = JSON.stringify(raw);
    const { positions, total_buyins, total_cashouts, variance } = prepareSettlementPositions(raw, 2000);
    expect({ total_buyins, total_cashouts, variance }).toEqual({
      total_buyins:6000, total_cashouts:6000, variance:0,
    });
    expect(positions.map(p => p.net)).toEqual([-1000,0,1000]);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('sums rebuy amounts and generates exactly two owed transfers', () => {
    const raw = [Player('Alex',2,4000,1500),Player('Ben',1,2000,3000),Player('Charlie',1,2000,3500)];
    const data = prepareSettlementPositions(raw, 2000);
    expect(data.total_buyins).toBe(8000);
    expect(data.total_cashouts).toBe(8000);
    expect(data.positions.map(p => p.net)).toEqual([-2500,1000,1500]);
    expect(minimumTransfers(data.positions).map(t => t.amount)).toEqual([1500,1000]);
  });

  it('supports the existing default buy-in fallback when no explicit amount was recorded', () => {
    const data = prepareSettlementPositions([
      {user_id:'A',display_name:'A',buy_ins:1,cashout:1000},
      {user_id:'B',display_name:'B',buy_ins:1,cashout:3000},
    ], 2000);
    expect(data.positions.map(p => p.buy_in_total)).toEqual([2000,2000]);
  });

  it('rejects a one-cent variance before any settlement is persisted', () => {
    try {
      prepareSettlementPositions([Player('Alex',1,2000,1000),Player('Charlie',1,2000,3001)], 2000);
      throw new Error('Expected rejection');
    } catch(e) {
      expect(e).toBeInstanceOf(SettlementValidationError);
      const err = e as SettlementValidationError;
      expect(err.status).toBe(422);
      expect(err.detail).toEqual({ total_buyins:4000, total_cashouts:4001, variance:1 });
    }
  });

  it('rejects bad or duplicate identities', () => {
    expect(() => prepareSettlementPositions([Player('Alex',1,2000,2000),Player('alex',1,2000,2000)], 2000)).toThrow(/Duplicate/);
    expect(() => prepareSettlementPositions([
      { ...Player('Alex',1,2000,2000),user_id:'same' },
      { ...Player('Ben',1,2000,2000),user_id:'same' },
    ], 2000)).toThrow(/Duplicate/);
    expect(() => prepareSettlementPositions([null,Player('Ben',1,2000,2000)], 2000)).toThrow(/Invalid/);
  });

  it('rejects unsafe, negative, missing or fractional financial values', () => {
    const valid = Player('Alex',1,2000,2000);
    const other = Player('Ben',1,2000,2000);
    for (const replacement of [
      { ...valid,cashout:NaN },
      { ...valid,cashout:Infinity },
      { ...valid,cashout:-1 },
      { ...valid,cashout:2000.5 },
      { ...valid,buy_ins:1.5 },
      { ...valid,buy_ins:-1 },
      { ...valid,buy_in_total:1.5 },
      { ...valid,buy_in_total:Number.MAX_SAFE_INTEGER + 1 },
      { ...valid,buy_ins:undefined },
    ]) {
      expect(() => prepareSettlementPositions([replacement,other], 2000)).toThrow();
    }
    expect(() => prepareSettlementPositions([
      { ...valid,buy_ins:Number.MAX_SAFE_INTEGER,buy_in_total:0 }, other,
    ], 2000)).toThrow(/precision/);
    expect(() => prepareSettlementPositions([valid,other], -1)).toThrow(/configuration/);
  });
});
