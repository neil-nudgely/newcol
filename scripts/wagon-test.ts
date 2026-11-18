import { createGame, isCoastal, isWaterfront } from '../src/sim/state';
import { foundTown, buildImprovement, sendWagons, moveUnit, trainUnit } from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

const s = createGame(1607, 'england');
s.treasury.england = 2000;

// Find a coastal grass tile and an upcountry (no water at all) grass tile at least 4 apart.
let coast: any = null, inland: any = null;
outer:
for (const a of s.tiles) {
  if (a.terrain !== 'grass' || !isCoastal(s, a.q, a.r)) continue;
  for (const b of s.tiles) {
    if (b.terrain !== 'grass' || isWaterfront(s, b.q, b.r)) continue;
    if (hexDist(a.q, a.r, b.q, b.r) >= 4) { coast = a; inland = b; break outer; }
  }
}
if (!coast || !inland) { console.log('FAIL could not find coastal+upcountry tiles'); process.exit(1); }
console.log(`coastal@${coast.q},${coast.r} inland@${inland.q},${inland.r}`);

// Found a town at each (teleport a settler there).
function foundAt(q: number, r: number): any {
  const u = s.units.find((x: any) => x.owner === 'england' && x.kind === 'settler');
  u.q = q; u.r = r;
  foundTown(s, 'england', u.id);
  return s.towns[s.towns.length - 1];
}
const coastTown = foundAt(coast.q, coast.r);
const inlandTown = foundAt(inland.q, inland.r);
coastTown.foundedThisTurn = false;
inlandTown.foundedThisTurn = false;

// 1. Dock allowed on coast
check('dock buildable on the shore', buildImprovement(s, 'england', coastTown.id, 'dock') === null);
// 2. Dock refused inland
const inlandDockErr = buildImprovement(s, 'england', inlandTown.id, 'dock');
check('dock refused inland', inlandDockErr !== null && /water|inland/i.test(inlandDockErr));
// 3. Wagon depot buildable inland
check('wagon depot buildable inland', buildImprovement(s, 'england', inlandTown.id, 'wagondepot') === null);
// finish construction instantly
coastTown.construction = null; coastTown.improvements.push('dock');
inlandTown.construction = null; inlandTown.improvements.push('wagondepot');

// 4. sendWagons moves goods to the port and takes a toll
inlandTown.stock.wheat = 10;
const portBefore = coastTown.stock.wheat;
const tollBefore = s.treasury.england;
const err = sendWagons(s, inlandTown.id, { wheat: 8 });
check('sendWagons succeeds', err === null);
check('goods moved to port', coastTown.stock.wheat === portBefore + 8 && inlandTown.stock.wheat === 2);
check('toll taken', s.treasury.england < tollBefore);
check('one convoy per turn', sendWagons(s, inlandTown.id, { wheat: 1 }) !== null);

// 5. sendWagons with no port fails
{
  const s2 = createGame(1607, 'england');
  s2.treasury.england = 2000;
  const u = s2.units.find((x: any) => x.owner === 'england' && x.kind === 'settler');
    const b = s2.tiles.find((t: any) => t.terrain === 'grass' && !isWaterfront(s2, t.q, t.r))!;
  u.q = b.q; u.r = b.r; foundTown(s2, 'england', u.id);
  const t = s2.towns[s2.towns.length - 1]; t.foundedThisTurn = false;
  t.improvements.push('wagondepot'); t.stock.wheat = 5;
  check('sendWagons fails with no port', /no port/i.test(sendWagons(s2, t.id, { wheat: 3 }) ?? ''));
}

// 6. Frigate can return to its own port
{
  const fr = trainUnit(s, 'england', coastTown.id, 'frigate');
  check('frigate trained at dock', fr === null);
  const f = s.units.find((u: any) => u.owner === 'england' && u.kind === 'frigate')!;
  f.moveLeft = 4; // next turn, the frigate can sail
  // sail out one tile of water
  const water = s.tiles.find((t: any) => (t.terrain === 'ocean' || t.terrain === 'coast') && hexDist(t.q, t.r, coastTown.q, coastTown.r) <= 2 && !(t.q === coastTown.q && t.r === coastTown.r));
  check('has adjacent water to sail out', !!water);
  const outErr = moveUnit(s, f.id, water!.q, water!.r);
  check('frigate sails out to water', outErr === null && f.q === water!.q);
  f.moveLeft = 4; // next turn
  const backErr = moveUnit(s, f.id, coastTown.q, coastTown.r);
  check('frigate returns to its own port', backErr === null && f.q === coastTown.q && f.r === coastTown.r);
}

console.log(`\nWAGON/DOCK/Frigate TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
