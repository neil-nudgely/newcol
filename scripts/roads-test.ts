import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, buildRoad, hasRoad, sendWagons, reachableTiles, roadTilesFor } from '../src/sim/sim';
import { SETTLED_MOVEMENT, GOODS } from '../src/sim/goods';
import type { GameState, GoodId, ImprovementId } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: GameState) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; eventChoice(s, e.id, 0); } };

let seq = 0;
function fakeTown(s: GameState, name: string, q: number, r: number, imp: ImprovementId[] = [], stock: Partial<Record<GoodId, number>> = {}) {
  const st: Record<GoodId, number> = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;
  Object.assign(st, stock);
  s.towns.push({ id: 700 + seq++, name, owner: 'england', q, r, pop: 2, improvements: imp, stock: st, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, landBought: [] });
  return s.towns[s.towns.length - 1];
}
function clearLane(s: GameState, q0: number, q1: number, r: number, terrain: 'hills' | 'grass') {
  for (let q = q0; q <= q1; q++) s.tiles[r * s.mapW + q].terrain = terrain;
}

// A: the contract.
{
  const s = createGame(1607);
  if (s.towns.some((t) => t.r === 10 && t.q >= 15 && t.q <= 25)) { check('A0 lane ground free', false); }
  clearLane(s, 16, 24, 10, 'hills'); // dear ground, so the lane is worth cutting
  const a = fakeTown(s, 'Westford', 16, 10);
  const b = fakeTown(s, 'Eastford', 24, 10);
  s.treasury.england = 10;
  check('A1 too poor to break ground', buildRoad(s, s.player, a.id, b.id) !== null);
  s.treasury.england = 500;
  const err = buildRoad(s, s.player, a.id, b.id);
  check(`A2 the survey begins [${err}]`, err === null && s.roadWork.length === 1 && s.treasury.england === 460);
  check('A3 no second contract on the line', buildRoad(s, s.player, a.id, b.id) !== null);
  check('A4 no road to yourself', buildRoad(s, s.player, a.id, a.id) !== null);
  check('A5 not through a rival town', buildRoad(s, s.player, a.id, 999) !== null);
  // three seasons of labour
  for (let i = 0; i < 3; i++) { endTurn(s); resolve(s); }
  const road = s.roads[0];
  check(`A6 the lane is cleared in three seasons [${s.roads.length}, work ${s.roadWork.length}]`, s.roads.length === 1 && s.roadWork.length === 0);
  check(`A7 the lane has ground under it [${road?.tiles.length}]`, (road?.tiles.length ?? 0) >= 9);
  check('A8 the road knows its ends', hasRoad(s, a.id, b.id) && hasRoad(s, b.id, a.id));
  check('A9 the completion is in the ledger', s.log.some((l) => l.includes('road from Westford to Eastford')));
  // and walking it is cheaper
  const costTo = (owner: 'england' | 'france') => {
    const u = { id: 900, owner, kind: 'militia' as const, q: 16, r: 10, moveLeft: 20, bombardedThisTurn: false };
    return reachableTiles(s, u).find((x) => x.q === 24 && x.r === 10)?.cost ?? Infinity;
  };
  const eng = costTo('england');
  const fre = costTo('france');
  check(`A10 your lane is dear ground to others [you ${eng}, them ${fre}]`, eng <= 10 && fre >= eng + 5);
  check('A11 roadTilesFor lists the lane', roadTilesFor(s, 'england').has(10 * s.mapW + 20));
}

// B: a lost end abandons the work.
{
  const s = createGame(1607);
  const a = fakeTown(s, 'Hopeful', 16, 10);
  const b = fakeTown(s, 'Doomed', 24, 10);
  s.treasury.england = 500;
  buildRoad(s, s.player, a.id, b.id);
  s.towns = s.towns.filter((t) => t.id !== b.id);
  for (let i = 0; i < 3; i++) { endTurn(s); resolve(s); }
  check('B1 the half-cut lane is abandoned', s.roads.length === 0 && s.roadWork.length === 0);
  check('B2 and you are told', s.log.some((l) => l.includes('abandoned')));
  void a;
}

// C: toll-free hauling along your own road.
{
  const s = createGame(1607);
  const a = fakeTown(s, 'Farmpatch', 16, 10, ['wagondepot'], { wheat: 10 });
  const b = fakeTown(s, 'Portfair', 20, 10, ['dock']);
  s.treasury.england = 500;
  const before = s.treasury.england;
  const err1 = sendWagons(s, a.id, { wheat: 5 });
  const paidToll = before - s.treasury.england;
  check(`C1 without a road the tollman takes his cut [£${paidToll}]`, err1 === null && paidToll >= 1);
  s.roads.push({ owner: 'england', a: a.id, b: b.id, tiles: [] });
  a.shippedThisTurn = false;
  const before2 = s.treasury.england;
  const err2 = sendWagons(s, a.id, { wheat: 5 });
  check(`C2 the road ends the toll [£${before2 - s.treasury.england}]`, err2 === null && before2 - s.treasury.england === 0);
  check('C3 the goods still land at port', b.stock.wheat === 10);
  check('C4 and the ledger says toll-free', s.log.some((l) => l.includes('toll-free along your own road')));
}

console.log(`ROAD TEST: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
