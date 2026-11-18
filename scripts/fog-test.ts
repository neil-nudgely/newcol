import { createGame, VIS_RADIUS, recomputeVisibility } from '../src/sim/state';
import { foundTown } from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

// 1. At start, the player's landing is revealed but most of the map is still dark.
{
  const s = createGame(1607);
  const explored = s.explored.filter(Boolean).length;
  const total = s.mapW * s.mapH;
  check('start: the landing is revealed', explored > 0);
  check('start: most of the land is still unexplored', explored < total * 0.3);
  const st = s.playerStart;
  check('start: the landing tile is in sight', s.visible[st.r * s.mapW + st.q]);
}

// 2. A tile within sight of a town is visible; a far tile is not.
{
  const s = createGame(1607);
  const u = s.units.find((x: any) => x.owner === s.player && x.kind === 'settler')!;
  foundTown(s, s.player, u.id);
  const t = s.towns.find((x: any) => x.owner === s.player)!;
  let nearVisible = false, farNotVisible = false;
  for (const x of s.tiles) {
    const d = hexDist(x.q, x.r, t.q, t.r);
    if (d === 1 && s.visible[x.r * s.mapW + x.q]) nearVisible = true;
    if (d > VIS_RADIUS + 2 && !s.visible[x.r * s.mapW + x.q]) farNotVisible = true;
  }
  check('a tile within sight of the town is visible', nearVisible);
  check('a far tile is not in sight', farNotVisible);
}

// 3. Moving into new ground charts it (explored grows, and the new tile is explored).
{
  const s = createGame(1607);
  const before = s.explored.filter(Boolean).length;
  const u = s.units.find((x: any) => x.owner === s.player && x.kind === 'settler')!;
  u.q += 10; u.r += 6;
  recomputeVisibility(s);
  const after = s.explored.filter(Boolean).length;
  check('exploring charts new ground', after > before);
  check('the ground you reach becomes explored', s.explored[u.r * s.mapW + u.q]);
}

// 4. Once seen, ground stays known (explored) even when it leaves your sight.
{
  const s = createGame(1607);
  const u = s.units.find((x: any) => x.owner === s.player && x.kind === 'settler')!;
  const hq = u.q, hr = u.r;
  recomputeVisibility(s);
  check('the home ground is explored', s.explored[hr * s.mapW + hq]);
  for (const p of s.units.filter((x: any) => x.owner === s.player)) { p.q += 24; p.r += 24; }
  recomputeVisibility(s);
  check('home ground stays explored after you leave', s.explored[hr * s.mapW + hq]);
  check('home ground is no longer in sight after you leave', !s.visible[hr * s.mapW + hq]);
}

console.log(`\nFOG TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
