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

describe('minimumTransfers', () => {
  it('returns nothing for empty or all-zero input', () => {
    expect(minimumTransfers([])).toEqual([]);
    expect(minimumTransfers([P('A', 0), P('B', 0)])).toEqual([]);
  });

  it('settles a balanced table exactly', () => {
    const pos = [P('A', 10000), P('B', -6000), P('C', -4000)];
    const m = moved(pos, minimumTransfers(pos));
    pos.forEach(p => expect(m[p.user_id].got - m[p.user_id].paid).toBe(p.net));
  });

  it('winners owed more than losers lost: losers pay everything, winners are scaled down', () => {
    const pos = [P('A', 10000), P('B', -4000)];
    const t = minimumTransfers(pos);
    expect(sum(t.map(x => x.amount))).toBe(4000);
    const m = moved(pos, t);
    expect(m['B'].paid).toBe(4000);
    expect(m['A'].got).toBeLessThanOrEqual(10000);
  });

  it('losers owe more than winners are owed: nobody receives more than they are owed', () => {
    const pos = [P('A', 4000), P('B', -6000), P('C', -4000)];
    const t = minimumTransfers(pos);
    expect(sum(t.map(x => x.amount))).toBe(4000);
    const m = moved(pos, t);
    expect(m['A'].got).toBe(4000);
    expect(m['B'].paid).toBeLessThanOrEqual(6000);
    expect(m['C'].paid).toBeLessThanOrEqual(4000);
  });

  it('random tables: conservation, no bad transfers, at most n-1 transfers when balanced', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let iter = 0; iter < 300; iter++) {
      const n = 2 + Math.floor(rnd() * 8);
      const nets = Array.from({ length: n }, () => Math.round((rnd() - 0.5) * 40000 / 25) * 25);
      const balanced = iter % 2 === 0;
      if (balanced) nets[n - 1] -= sum(nets);
      const pos = nets.map((x, i) => P('P' + i, x));
      const t = minimumTransfers(pos);
      const m = moved(pos, t);
      t.forEach(x => { expect(x.amount).toBeGreaterThan(0); expect(x.from).not.toBe(x.to); });
      pos.forEach(p => {
        if (p.net >= 0) expect(m[p.user_id].paid).toBe(0);
        if (p.net <= 0) expect(m[p.user_id].got).toBe(0);
        if (p.net > 0) expect(m[p.user_id].got).toBeLessThanOrEqual(p.net);
        if (p.net < 0) expect(m[p.user_id].paid).toBeLessThanOrEqual(-p.net);
      });
      const cred = sum(pos.filter(p => p.net > 0).map(p => p.net));
      const debt = sum(pos.filter(p => p.net < 0).map(p => -p.net));
      expect(sum(t.map(x => x.amount))).toBe(Math.min(cred, debt));
      if (balanced) {
        expect(t.length).toBeLessThanOrEqual(n - 1);
        pos.forEach(p => expect(m[p.user_id].got - m[p.user_id].paid).toBe(p.net));
      }
    }
  });
});
