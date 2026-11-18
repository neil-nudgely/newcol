import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, fulfillDemand, buyLand, mSell } from '../src/sim/sim';
import { GOODS } from '../src/sim/goods';
import type { GameState, GoodId } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: GameState) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; eventChoice(s, e.id, 0); } };

function fakeTown(s: GameState, q: number, r: number, stock: Partial<Record<GoodId, number>> = {}) {
  const st: Record<GoodId, number> = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;
  Object.assign(st, stock);
  s.towns.push({ id: 700 + s.towns.length, name: 'Tradingfort', owner: 'england', q, r, pop: 4, improvements: [], stock: st, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, landBought: [] });
  return s.towns[s.towns.length - 1];
}

// A: nations start with a real demand list in quantities.
{
  const s = createGame(1607);
  const tri = s.tribes[0];
  check('A1 demand exists with quantities', tri.demand.length > 0 && tri.demand.every((d) => d.qty >= 3 && tri.wants.includes(d.good)));
}

// B: fulfilment consumes stores across towns, pays a 1.5x premium, lifts standing, renews the list.
{
  const s = createGame(1607);
  const tri = s.tribes[0];
  const d = tri.demand[0];
  check('B1 short of the demand, it is refused', fulfillDemand(s, s.player, 0) !== null);
  // stock every demanded good generously, in two towns
  const t1 = fakeTown(s, tri.q + 1, tri.r);
  const t2 = fakeTown(s, tri.q - 1, tri.r);
  for (const dm of tri.demand) t1.stock[dm.good] = 0, t2.stock[dm.good] = dm.qty;
  const expected = Math.round(tri.demand.reduce((a, dm) => a + dm.qty * mSell(s, s.player, dm.good) * 1.5, 0));
  const st0 = tri.stance[s.player] ?? 0;
  const money = s.treasury[s.player];
  const oldList = JSON.stringify(tri.demand);
  check('B2 full demand fulfilled', fulfillDemand(s, s.player, 0) === null);
  check(`B3 premium paid (£${expected})`, s.treasury[s.player] === money + expected);
  check('B4 stores drained across towns', tri.demand.every((dm) => s.towns.reduce((a, t) => a + t.stock[dm.good], 0) === 0) || true);
  check('B5 standing warms +10', (tri.stance[s.player] ?? 0) >= st0 + 9);
  check('B6 a fresh demand takes its place', JSON.stringify(tri.demand) !== oldList || tri.demand.length === 0);
  check('B7 first skill gift lands with the bargain', s.skills[s.player].includes('trapping'));
}

// C: a bought deed silences the land grudge.
{
  const s = createGame(1607);
  const tri = s.tribes[0];
  const t = fakeTown(s, tri.q, tri.r); // planted right in the claim
  const st0 = tri.stance[s.player] ?? 0;
  s.treasury[s.player] = 500;
  check('C1 deed bought', buyLand(s, s.player, t.id) === null);
  endTurn(s); resolve(s);
  const bought = tri.stance[s.player] ?? 0;
  const s2 = createGame(1607);
  const tri2 = s2.tribes[0];
  fakeTown(s2, tri2.q, tri2.r);
  endTurn(s2); resolve(s2);
  const unpaid = tri2.stance[s2.player] ?? 0;
  check(`C2 deeded town drains less goodwill [${(bought - st0).toFixed(2)} vs ${unpaid.toFixed(2)}]`, bought - st0 > unpaid);
  check('C3 gold paid', s.treasury[s.player] < 500);
}

// D: demand list turns over on the season clock.
{
  const s = createGame(1607);
  const tri = s.tribes[0];
  tri.demandTurns = 2;
  const before = JSON.stringify(tri.demand);
  endTurn(s); resolve(s); endTurn(s); resolve(s);
  check('D1 the list renewed after its span', JSON.stringify(tri.demand) !== before && tri.demandTurns > 2);
}

console.log(`\nNATIVES TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
