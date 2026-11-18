import { createGame, eventChoice, recomputeVisibility } from '../src/sim/state';
import { endTurn, trainUnit, unitStrength, defenseOf, reachableTiles, moveUnit } from '../src/sim/sim';
import { SETTLED_MOVEMENT, GOODS } from '../src/sim/goods';
import { neighbors, hexDist } from '../src/sim/hex';
import type { GameState, GoodId, Unit, UnitKind } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: GameState) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; eventChoice(s, e.id, 0); } };

let townSeq = 0;
function town(s: GameState, owner: 'england' | 'france' = 'england', muskets = 0) {
  const id = 500 + townSeq++;
  const st: Record<GoodId, number> = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;
  st.muskets = muskets;
  s.towns.push({ id, name: 'Garrisonby', owner, q: 20, r: 10, pop: 2, improvements: [], stock: st, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, landBought: [] });
  return s.towns[s.towns.length - 1];
}
function mkUnit(s: GameState, owner: 'england' | 'france', kind: UnitKind, q: number, r: number): Unit {
  const u: Unit = { id: s.nextUnitId++, owner, kind, q, r, moveLeft: 20, bombardedThisTurn: false };
  s.units.push(u);
  return u;
}

// A: the war economy — muskets make soldiers.
{
  const s = createGame(1607);
  const bare = town(s, 'england', 0);
  s.treasury.england = 500;
  check('A1 no musket, no soldier', trainUnit(s, s.player, bare.id, 'soldier') !== null);
  const t = town(s, 'england', 2);
  const err = trainUnit(s, s.player, t.id, 'soldier');
  const sol = s.units.find((u) => u.kind === 'soldier');
  check(`A2 a store of muskets arms a line soldier [${err}]`, err === null && !!sol);
  check('A3 the musket left the store', t.stock.muskets === 1);
  check(`A4 soldier strength 5 [${sol ? unitStrength(sol) : -1}]`, !!sol && unitStrength(sol) === 5);
  t.trainedThisTurn = false;
  const err2 = trainUnit(s, s.player, t.id, 'ranger');
  check(`A5 the open country breeds no rangers [${err2}]`, err2 !== null && !s.units.some((u) => u.kind === 'ranger'));
}

// B: rangers — the woods' own children.
{
  const s = createGame(1607);
  const t = town(s, 'england', 3);
  s.tiles[10 * s.mapW + 21].terrain = 'forest'; // a wood beside the town
  s.treasury.england = 500;
  const err = trainUnit(s, s.player, t.id, 'ranger');
  const r = s.units.find((u) => u.kind === 'ranger');
  check(`B1 a forest home trains a ranger [${err}]`, err === null && !!r);
  endTurn(s); resolve(s);
  check(`B2 ranger legs: SETTLED + 1 [${r?.moveLeft}]`, (r?.moveLeft ?? 0) === SETTLED_MOVEMENT + 1);
  const hill = neighbors(20, 10).find((n) => n.r * s.mapW + n.q !== 10 * s.mapW + 21 && s.tiles[n.r * s.mapW + n.q]);
  s.tiles[hill.r * s.mapW + hill.q].terrain = 'hills';
  const m = mkUnit(s, 'england', 'militia', 20, 10);
  const rc = reachableTiles(s, r!).find((x) => x.q === hill.q && x.r === hill.r)?.cost;
  const mc = reachableTiles(s, m).find((x) => x.q === hill.q && x.r === hill.r)?.cost;
  check(`B3 the ranger takes the high ground cheaply [ranger ${rc}, militia ${mc}]`, rc === 1 && mc === 2);
}

// C: what a ranger sees, a militiaman does not.
{
  const s = createGame(1607);
  const spot = { q: 5, r: 5 };
  const r = mkUnit(s, 'england', 'ranger', spot.q, spot.r);
  const ring = [];
  for (let rr = 0; rr < s.mapH; rr++) for (let qq = 0; qq < s.mapW; qq++) {
    if (hexDist(qq, rr, spot.q, spot.r) === 4) ring.push(rr * s.mapW + qq);
  }
  recomputeVisibility(s);
  const seenByRanger = ring.filter((i) => s.visible[i]).length;
  r.kind = 'militia';
  recomputeVisibility(s);
  const seenByMilitia = ring.filter((i) => s.visible[i]).length;
  check(`C1 the ranger's eye reaches further [${seenByRanger} vs ${seenByMilitia}]`, seenByRanger > 0 && seenByMilitia === 0);
}

// D: the town's defence is the sum of the guns on the square.
{
  const s = createGame(1607);
  const t = town(s);
  const base = defenseOf(s, t);
  const sol = mkUnit(s, 'england', 'soldier', t.q, t.r);
  mkUnit(s, 'england', 'militia', t.q, t.r);
  const v = defenseOf(s, t);
  check(`D1 defence counts soldier 5 and militiaman 3 [${base} -> ${v}]`, v - base === 8);
  sol.veterans = 2;
  check(`D2 veterans add +2 [${defenseOf(s, t)}]`, defenseOf(s, t) - base === 10);
}

// E: victories harden the man who wins them.
{
  const s = createGame(1607);
  town(s);
  let a: { q: number; r: number } | null = null;
  let b: { q: number; r: number } | null = null;
  outer: for (let r = 3; r < s.mapH - 3; r++) for (let q = 3; q < s.mapW - 3; q++) {
    if (s.towns.some((x) => Math.abs(x.q - q) + Math.abs(x.r - r) < 4)) continue;
    if (s.units.some((x) => Math.abs(x.q - q) + Math.abs(x.r - r) < 3)) continue;
    const ta = s.tiles[r * s.mapW + q];
    if (!ta || ta.terrain !== 'grass') continue;
    for (const n of neighbors(q, r)) {
      const tb = s.tiles[n.r * s.mapW + n.q];
      if (tb && tb.terrain === 'grass' && !s.towns.some((x) => Math.abs(x.q - n.q) + Math.abs(x.r - n.r) < 4)) {
        a = { q, r }; b = { q: n.q, r: n.r }; break outer;
      }
    }
  }
  if (!a || !b) { check('E1 found two open grass neighbours', false); }
  else {
    const sol = mkUnit(s, 'england', 'soldier', a.q, a.r);
    mkUnit(s, 'france', 'militia', b.q, b.r);
    const mv = moveUnit(s, sol.id, b.q, b.r);
    check(`E2 the soldier takes the field [${mv}]`, mv === null);
    check(`E3 one victory marks him [${sol.veterans ?? 0}]`, (sol.veterans ?? 0) === 1);
    check(`E4 strength 6 after the win [${unitStrength(sol)}]`, unitStrength(sol) === 6);
    sol.veterans = 2;
    const c = neighbors(b.q, b.r).find((n) => s.tiles[n.r * s.mapW + n.q]?.terrain === 'grass');
    if (c) {
      mkUnit(s, 'france', 'militia', c.q, c.r);
      const mv2 = moveUnit(s, sol.id, c.q, c.r);
      check(`E5 hardening caps at two [${mv2}, ${sol.veterans}, ${unitStrength(sol)}]`, mv2 === null && sol.veterans === 2 && unitStrength(sol) === 7);
    } else check('E5 hardening caps at two', sol.veterans === 2);
  }
}

console.log(`SOLDIER TEST: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
