import { createGame, isSettleable } from '../src/sim/state';
import { moveUnit, foundTown, defenseOf } from '../src/sim/sim';
import { neighbors } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

// Find two adjacent settleable tiles to fight on.
function pair(s: any): [any, any] {
  for (const t of s.tiles) {
    if (!isSettleable(t.terrain)) continue;
    const n = neighbors(t.q, t.r).find((x: any) => {
      const nt = s.tiles.find((z: any) => z.q === x.q && z.r === x.r);
      return nt && isSettleable(nt.terrain);
    });
    if (n) {
      const nt = s.tiles.find((z: any) => z.q === n.q && z.r === n.r)!;
      return [t, nt];
    }
  }
  throw new Error('no adjacent land');
}

const MIL = (s: any, owner: string, q: number, r: number, id: number) =>
  s.units.push({ id, owner, kind: 'militia', q, r, moveLeft: 4, bombardedThisTurn: false });
const SET = (s: any, owner: string, q: number, r: number, id: number) =>
  s.units.push({ id, owner, kind: 'settler', q, r, moveLeft: 4, bombardedThisTurn: false });

// 1. Militia (3) beats an undefended settler (1)
{
  const s = createGame(1607, 'england');
  const [a, b] = pair(s);
  MIL(s, 'england', a.q, a.r, 90);
  SET(s, 'france', b.q, b.r, 91);
  const err = moveUnit(s, 90, b.q, b.r);
  check('militia kills undefended settler', err === null && !s.units.some((u: any) => u.id === 91) && s.units.find((u: any) => u.id === 90)!.q === b.q);
}

// 2. Settler (1) loses to a militia (3)
{
  const s = createGame(1607, 'england');
  const [a, b] = pair(s);
  SET(s, 'england', a.q, a.r, 90);
  MIL(s, 'france', b.q, b.r, 91);
  const err = moveUnit(s, 90, b.q, b.r);
  check('settler killed by militia', err !== null && !s.units.some((u: any) => u.id === 90) && s.units.some((u: any) => u.id === 91));
}

// 3. Militia captures an undefended enemy town
{
  const s = createGame(1607, 'england');
  foundTown(s, 'france', s.units.find((u: any) => u.owner === 'france')!.id);
  const town = s.towns.find((t: any) => t.owner === 'france')!;
  const start = s.units.find((u: any) => u.owner === 'england')!;
  MIL(s, 'england', start.q, start.r, 90);
  // teleport the militia next to the town (same map, just adjacent) so the move is legal
  const m = s.units.find((u: any) => u.id === 90)!;
  m.q = town.q; m.r = town.r; m.moveLeft = 0; // on the town tile already? no — put adjacent
  // find an adjacent tile to the town that is settleable to stand on
  const adj = neighbors(town.q, town.r).find((x: any) => { const nt = s.tiles.find((z: any) => z.q === x.q && z.r === x.r); return nt && isSettleable(nt.terrain); });
  m.q = adj!.q; m.r = adj!.r; m.moveLeft = 4;
  const before = town.owner;
  const err = moveUnit(s, 90, town.q, town.r);
  check(`militia captures undefended town (was ${before})`, err === null && town.owner === 'england' && town.pop > 0);
}

// 4. Militia is repelled by a fortified enemy town
{
  const s = createGame(1607, 'england');
  foundTown(s, 'france', s.units.find((u: any) => u.owner === 'france')!.id);
  const town = s.towns.find((t: any) => t.owner === 'france')!;
  town.improvements.push('fort');
  const start = s.units.find((u: any) => u.owner === 'england')!;
  MIL(s, 'england', start.q, start.r, 90);
  const m = s.units.find((u: any) => u.id === 90)!;
  const adj = neighbors(town.q, town.r).find((x: any) => { const nt = s.tiles.find((z: any) => z.q === x.q && z.r === x.r); return nt && isSettleable(nt.terrain); });
  m.q = adj!.q; m.r = adj!.r; m.moveLeft = 4;
  const def = defenseOf(s, town);
  const err = moveUnit(s, 90, town.q, town.r);
  check(`militia repelled by fortified town (def ${def})`, err !== null && town.owner === 'france' && !s.units.some((u: any) => u.id === 90));
}

// 5. No combat on an empty tile
{
  const s = createGame(1607, 'england');
  const [a, b] = pair(s);
  MIL(s, 'england', a.q, a.r, 90);
  const err = moveUnit(s, 90, b.q, b.r);
  check('no combat on empty tile', err === null && s.units.find((u: any) => u.id === 90)!.q === b.q);
}

console.log(`\nCOMBAT TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
