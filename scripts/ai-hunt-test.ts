import { createGame, eventChoice, isLand } from '../src/sim/state';
import { endTurn, foundTown, HUNT_INTERVAL } from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any) => { let g = 0; while (s.pendingEvents.length > 0 && g++ < 20) { const e = s.pendingEvents[0]; const i = e.kind === 'tax' ? 1 : 0; if (!eventChoice(s, e.id, i)) break; } };

// 1. AI (rival) sells to a tribe it has surplus stock for
{
  const s = createGame(1607, 'england', 1); // france is the rival
  const tri: any = s.tribes[0];
  // found a france town near the tribe
  const f = s.units.find((u: any) => u.owner === 'france')!;
  let spot: any = null;
  for (const t of s.tiles) {
    if (t.terrain !== 'grass') continue;
    const d = hexDist(t.q, t.r, tri.q, tri.r);
    if (d > tri.claimRadius - 1 && d <= tri.claimRadius + 2) { spot = t; break; }
  }
  f.q = spot.q; f.r = spot.r;
  foundTown(s, 'france', f.id);
  const ftown = s.towns.find((t: any) => t.owner === 'france')!;
  ftown.foundedThisTurn = false;
  tri.wants = ['iron', 'spices'];
  ftown.stock.iron = 6;
  const stanceBefore = tri.stance['france'] ?? 0;
  const stockBefore = ftown.stock.iron;
  endTurn(s); resolve(s);
  endTurn(s); resolve(s); // turn 2 -> AI trade triggers
  check('AI sold to tribe: town stock reduced', ftown.stock.iron < stockBefore);
  check('AI sold to tribe: standing with the nation rose', (tri.stance['france'] ?? 0) > stanceBefore);
}

// 2. AI does not sell what the tribe does not want
{
  const s = createGame(1607, 'england', 1);
  const tri: any = s.tribes[0];
  const f = s.units.find((u: any) => u.owner === 'france')!;
  let spot: any = null;
  for (const t of s.tiles) {
    if (t.terrain !== 'grass') continue;
    const d = hexDist(t.q, t.r, tri.q, tri.r);
    if (d > tri.claimRadius - 1 && d <= tri.claimRadius + 2) { spot = t; break; }
  }
  f.q = spot.q; f.r = spot.r;
  foundTown(s, 'france', f.id);
  const ftown = s.towns.find((t: any) => t.owner === 'france')!;
  ftown.foundedThisTurn = false;
  tri.wants = ['iron']; // only wants iron
  ftown.stock.sugar = 6; // but only has sugar
  const stockBefore = ftown.stock.sugar;
  endTurn(s); resolve(s);
  endTurn(s); resolve(s);
  check('AI does not sell a good the tribe does not want', ftown.stock.sugar === stockBefore);
}

// 3. Hunting migrations move nations across their home ground (each turn is a year)
{
  const s = createGame(1607, 'england', 1);
  const tri: any = s.tribes[0];
  const homeQ = tri.homeQ, homeR = tri.homeR;
  const startQ = tri.q, startR = tri.r;
  let moved = false;
  for (let i = 0; i < 8 && !moved; i++) {
    for (let j = 0; j < HUNT_INTERVAL; j++) { endTurn(s); resolve(s); }
    if (tri.q !== startQ || tri.r !== startR) moved = true;
  }
  check('hunt: a nation moved to new grounds over the years', moved);
  check('hunt: still on land', isLand((s.tiles.find((t: any) => t.q === tri.q && t.r === tri.r)?.terrain as any)));
  check('hunt: within 8 of its home ground', hexDist(tri.q, tri.r, homeQ, homeR) <= 8);
  check('hunt: at least 3 from its home ground', hexDist(tri.q, tri.r, homeQ, homeR) >= 3 || !moved);
  check('hunt: the log mentions the move', s.log.some((l: string) => l.includes('hunting grounds')));
}

console.log(`\nAI-TRADE + HUNTS TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
