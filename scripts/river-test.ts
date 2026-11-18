import { createGame, isWaterfront, isCoastal } from '../src/sim/state';
import { foundTown, buildImprovement, sendShip } from '../src/sim/sim';
import { neighbors } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

// Rivers are carved and at least one reaches the sea.
{
  let reaches = false;
  for (const seed of [1607, 2024, 777]) {
    const s = createGame(seed);
    for (const t of s.tiles) {
      if (t.terrain !== 'river') continue;
      for (const n of neighbors(t.q, t.r)) {
        if (n.q < 0 || n.r < 0 || n.q >= s.mapW || n.r >= s.mapH) continue;
        const nt = s.tiles[n.r * s.mapW + n.q];
        if (nt && (nt.terrain === 'coast' || nt.terrain === 'ocean')) { reaches = true; break; }
      }
      if (reaches) break;
    }
    if (reaches) break;
  }
  check('rivers are carved and reach the sea', reaches);
}

// A town on a river bank (upcountry but waterfront) can build a dock and ship.
{
  const s = createGame(1607, 'england');
  s.treasury.england = 500;
  const site = s.tiles.find((t) => t.terrain === 'grass' && !isCoastal(s, t.q, t.r) && isWaterfront(s, t.q, t.r));
  check('found a river-bank (upcountry, waterfront) site', !!site);
  if (site) {
    const u = s.units.find((x: any) => x.owner === 'england' && x.kind === 'settler')!;
    u.q = site.q; u.r = site.r; foundTown(s, 'england', u.id);
    const t = s.towns[s.towns.length - 1]; t.foundedThisTurn = false;
    check('dock buildable on a river bank', buildImprovement(s, 'england', t.id, 'dock') === null);
    t.construction = null; t.improvements.push('dock');
    t.stock.wheat = 10;
    check('a river town can ship to Europe', sendShip(s, t.id, { wheat: 10 }) === null);
  }
}

// A truly upcountry town (no sea, no river) still needs a wagon depot.
{
  const s = createGame(1607, 'england');
  s.treasury.england = 500;
  const site = s.tiles.find((t) => t.terrain === 'grass' && !isWaterfront(s, t.q, t.r));
  check('found a truly upcountry (no water) site', !!site);
  if (site) {
    const u = s.units.find((x: any) => x.owner === 'england' && x.kind === 'settler')!;
    u.q = site.q; u.r = site.r; foundTown(s, 'england', u.id);
    const t = s.towns[s.towns.length - 1]; t.foundedThisTurn = false;
    check('dock refused upcountry (no water)', buildImprovement(s, 'england', t.id, 'dock') !== null);
    check('wagon depot buildable upcountry', buildImprovement(s, 'england', t.id, 'wagondepot') === null);
  }
}

console.log(`\nRIVER TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
