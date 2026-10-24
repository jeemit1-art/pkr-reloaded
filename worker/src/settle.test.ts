import { describe, it, expect } from 'vitest';
import { minimumTransfers } from './settle';

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
