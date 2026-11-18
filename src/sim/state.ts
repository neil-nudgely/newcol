import { clamp, mulberry32 } from './rng';
import { hexDist, neighbors } from './hex';
import { SETTLED_MOVEMENT, RIVAL_OF, EMPIRE_NAMES, GOODS } from './goods';
import type { GameEvent, GameState, GoodId, Owner, Tile, Town, Tribe, Terrain, TribeId, Unit } from './types';

export const MAP_W = 48;
export const MAP_H = 34;
export const START_YEAR = 1607;

// ---------- disease ----------
export const DISEASE_NAMES = ['Smallpox', 'Measles', 'Influenza', 'Dysentery', 'Typhus'] as const;
/** Fraction of a town's population lost when an outbreak reaches it. */
export const TOWN_MORTALITY = 0.25;
/** Fraction of a nation's population lost — the toll on them is far heavier. */
export const TRIBAL_MORTALITY = 0.35;
/** Hexes within which an outbreak hops to the next settlement each turn. */
export const OUTBREAK_SPREAD_RADIUS = 6;
/** Turns an outbreak runs before it dies out on its own. */
export const OUTBREAK_DURATION = 6;
/** What a player can pay to halve the toll on one of their own towns. */
export const QUARANTINE_COST = 20;
/** Turns a survivor of an outbreak is left alone — the fever skips the immune. */
export const OUTBREAK_IMMUNITY = 12;

const TOWN_NAMES: Record<Owner, readonly string[]> = {
  england: [
    'Jamestown', 'Williamsburg', 'Richmond', 'Yorktown', 'Alexandria',
    'Newport', 'Petersburg', 'Lancaster', 'New Point', 'Hampton',
    'Middlesex', 'Surry',
  ],
  france: ['Port-Royal', 'Beaubassin', 'Kamouraska', 'Rivière', 'Louisbourg', 'Quebec'],
  spain: ['San Miguel', 'Santa Elena', 'St. Augustine', 'Puerto Real', 'Santa Rosa', 'Isabela'],
  netherlands: ['New Amsterdam', 'Fort Orange', 'Rensselaerswyck', 'Albany', 'Schenectady', 'Wiltwyck'],
  sweden: ['New Sweden', 'Fort Christina', 'New Gothenburg', 'Wilmington', 'New Elsinore', 'New Ängar'],
  portugal: ['São Jorge', 'Ribeira Grande', 'Porto Feliz', 'Nova Lisboa', 'Caminho Real', 'Vila Bela'],
  denmark: ['New Godhavn', 'St. Christian', 'Frederiksborg', 'New Odense', 'St. Thomas', 'Copenhagen Bay'],
  prussia: ['Königsberg', 'Breslau Bay', 'Potsdam Point', 'New Berlin', 'Stettin', 'Frankfurt Shore'],
  russia: ['Novy Archangel', 'St. Michael', 'Ossory', 'New Muscovy', 'Kadiak Landing', 'Petro Bay'],
};

const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function newTownName(s: GameState, owner: Owner): string {
  const names = TOWN_NAMES[owner];
  const count = s.towns.filter((t) => t.owner === owner).length;
  const base = names[Math.min(count, names.length - 1)];
  if (count < names.length) return base;
  return `${base} ${NUMERALS[(count - names.length) % NUMERALS.length]}`;
}

function makeNoise(seedFn: () => number, scale: number): (x: number, y: number) => number {
  const g = 16;
  const v: number[] = [];
  for (let i = 0; i < g * g; i++) v.push(seedFn());
  const at = (ix: number, iy: number) =>
    v[((iy % g + g) % g) * g + ((ix % g + g) % g)];
  return (x, y) => {
    const fx = x * scale;
    const fy = y * scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function terrainFor(elev: number): Terrain {
  if (elev < 0.3) return 'ocean';
  if (elev < 0.38) return 'coast';
  if (elev < 0.56) return 'grass';
  if (elev < 0.74) return 'forest';
  if (elev < 0.86) return 'hills';
  return 'mountain';
}

function generateTiles(rng: () => number): Tile[] {
  const n1 = makeNoise(rng, 3.2);
  const n2 = makeNoise(rng, 8.5);
  const tiles: Tile[] = [];
  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) {
      const x = q / (MAP_W - 1);
      const y = r / (MAP_H - 1);
      let e = 0.62 * n1(x, y) + 0.38 * n2(x, y);
      const east = clamp((x - 0.72) / 0.28, 0, 1);
      e -= east * east * 0.55;
      const t = (x - 0.5) / 0.5;
      if (t > 0) {
        const yc = 0.5 + 0.2 * Math.sin(t * 2.4 + 0.7);
        const w = 0.1 + t * 0.16;
        const d = Math.abs(y - yc);
        if (d < w) e = Math.min(e, 0.22 - (d / w) * 0.1);
      }
      e -= (1 - y) * 0.12;
      tiles.push({ q, r, terrain: terrainFor(e), elev: e });
    }
  }
  // Erode inland sand: a beach tile with no land beside it is just a pointless
  // sandbar — turn it back to water so the shoreline stays a thin beach.
  const isLandTerrain = (t: Terrain) => t === 'grass' || t === 'forest' || t === 'hills' || t === 'mountain';
  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) {
      const t = tiles[r * MAP_W + q];
      if (t.terrain !== 'coast') continue;
      let nearLand = false;
      for (const n of neighbors(q, r)) {
        if (n.q < 0 || n.r < 0 || n.q >= MAP_W || n.r >= MAP_H) continue;
        if (isLandTerrain(tiles[n.r * MAP_W + n.q].terrain)) { nearLand = true; break; }
      }
      if (!nearLand) t.terrain = 'ocean';
    }
  }
  carveRivers(tiles);
  return tiles;
}

/** Carve a few rivers from inland sources down to the sea, following the slope toward the coast. */
function carveRivers(tiles: Tile[]): void {
  // Distance of every tile to the nearest beach (BFS out from the coast).
  const dist: number[] = new Array(tiles.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].terrain === 'coast') { dist[i] = 0; queue.push(i); }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const t = tiles[i];
    for (const n of neighbors(t.q, t.r)) {
      if (n.q < 0 || n.r < 0 || n.q >= MAP_W || n.r >= MAP_H) continue;
      const j = n.r * MAP_W + n.q;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  // Pick well-spread inland sources, the farthest-from-the-sea first.
  const cand = tiles
    .filter((t) => isLand(t.terrain) && dist[t.r * MAP_W + t.q] >= 6)
    .sort((a, b) => dist[b.r * MAP_W + b.q] - dist[a.r * MAP_W + a.q]);
  const sources: Tile[] = [];
  for (const t of cand) {
    if (sources.length >= 5) break;
    if (sources.every((s) => hexDist(s.q, s.r, t.q, t.r) >= 9)) sources.push(t);
  }
  for (const src of sources) {
    let q = src.q, r = src.r;
    for (let step = 0; step < 64; step++) {
      const tile = tiles[r * MAP_W + q];
      if (tile.terrain === 'coast' || tile.terrain === 'ocean') break; // reached the sea
      if (tile.terrain === 'grass' || tile.terrain === 'forest' || tile.terrain === 'hills') tile.terrain = 'river';
      let bq = -1, br = -1, bd = dist[r * MAP_W + q];
      for (const n of neighbors(q, r)) {
        if (n.q < 0 || n.r < 0 || n.q >= MAP_W || n.r >= MAP_H) continue;
        const nt = tiles[n.r * MAP_W + n.q];
        if (nt.terrain === 'mountain') continue;
        const d = dist[n.r * MAP_W + n.q];
        if (d < bd) { bd = d; bq = n.q; br = n.r; }
      }
      if (bq === -1) break; // dead end
      q = bq; r = br;
    }
  }
}

export function tileAt(s: GameState, q: number, r: number): Tile | null {
  if (q < 0 || r < 0 || q >= s.mapW || r >= s.mapH) return null;
  return s.tiles[r * s.mapW + q];
}

export function isLand(terrain: Terrain): boolean {
  return terrain === 'grass' || terrain === 'forest' || terrain === 'hills';
}

export function isSettleable(terrain: Terrain): boolean {
  return terrain === 'grass' || terrain === 'forest';
}

export function isCoastal(s: GameState, q: number, r: number): boolean {
  for (const n of neighbors(q, r)) {
    const t = tileAt(s, n.q, n.r);
    if (t && (t.terrain === 'ocean' || t.terrain === 'coast')) return true;
  }
  return false;
}

/** A town can raise a dock if it fronts the sea OR a river. */
/** The village's trading season: 1-2 goods sought in real quantities (docs §5). */
export function rollDemand(wants: GoodId[], rng: () => number): { good: GoodId; qty: number }[] {
  const picks: { good: GoodId; qty: number }[] = [];
  const pool = [...wants];
  const n = pool.length === 0 ? 0 : pool.length < 2 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const idx = Math.min(pool.length - 1, Math.floor(rng() * Math.min(5, pool.length)));
    const good = pool.splice(idx, 1)[0];
    picks.push({ good, qty: 3 + Math.floor(rng() * 4) });
  }
  return picks;
}

export function isWaterfront(s: GameState, q: number, r: number): boolean {
  if (isCoastal(s, q, r)) return true;
  for (const n of neighbors(q, r)) {
    const t = tileAt(s, n.q, n.r);
    if (t && t.terrain === 'river') return true;
  }
  return false;
}

// ---------- fog of war ----------
/** How far (in hexes) a settler, militiaman, or town can see. */
export const VIS_RADIUS = 3;
/** A ranger scans further than any regular — the woods teach eyes. */
export const RANGER_VIS = 5;

/** Recompute which tiles the player can currently see, and mark newly seen tiles as explored. */
export function recomputeVisibility(s: GameState): void {
  s.visible = new Array(s.mapW * s.mapH).fill(false);
  if (!s.explored || s.explored.length !== s.mapW * s.mapH) s.explored = new Array(s.mapW * s.mapH).fill(false);
  const reveal = (q: number, r: number, rad = VIS_RADIUS) => {
    for (let rr = r - rad; rr <= r + rad; rr++) {
      for (let qq = q - rad; qq <= q + rad; qq++) {
        if (qq < 0 || rr < 0 || qq >= s.mapW || rr >= s.mapH) continue;
        if (hexDist(qq, rr, q, r) > rad) continue;
        s.visible[rr * s.mapW + qq] = true;
      }
    }
  };
  for (const u of s.units) if (u.owner === s.player) reveal(u.q, u.r, u.kind === 'ranger' ? RANGER_VIS : VIS_RADIUS);
  for (const t of s.towns) if (t.owner === s.player) reveal(t.q, t.r);
  for (let i = 0; i < s.explored.length; i++) if (s.visible[i]) s.explored[i] = true;
}

function findStart(
  tiles: Tile[],
  tribes: Array<{ q: number; r: number; claimRadius: number }>,
  pred: (t: Tile) => boolean,
): Tile | null {
  const outsideClaims = (t: Tile) =>
    tribes.every((tr) => hexDist(t.q, t.r, tr.q, tr.r) > tr.claimRadius + 1);
  const withClaims = tiles.filter((t) => pred(t) && outsideClaims(t));
  if (withClaims.length > 0) return withClaims[0];
  const loose = tiles.filter(pred);
  if (loose.length > 0) return loose[0];
  return null;
}

function fallbackLand(tiles: Tile[]): Tile {
  return tiles.find((t) => isLand(t.terrain)) ?? tiles[0];
}

// ---------- empire scenarios ----------

interface TribeDef {
  id: TribeId;
  name: string;
  pop: number;
  claimRadius: number;
  band: (t: Tile) => boolean;
  nearWater: boolean;
  stance: number;
  stanceRival: number;
}

interface EmpireScenario {
  startBand: (t: Tile) => boolean;
  tribes: [TribeDef, TribeDef];
}

const B = (q0: number, q1: number, r0: number, r1: number) =>
  (t: Tile) => t.q > MAP_W * q0 && t.q < MAP_W * q1 && t.r > MAP_H * r0 && t.r < MAP_H * r1;

/** True if (q,r) lies inside an empire's home corridor — used to keep AI expansion out of others' lands. */
export const inStartBand = (o: Owner, q: number, r: number): boolean =>
  SCENARIOS[o].startBand({ q, r } as Tile);

const WANT_PRIORITY: GoodId[] = ['tools', 'muskets', 'tradeGoods', 'cloth', 'iron', 'silver', 'spices', 'tobacco', 'sugar', 'indigo', 'lumber', 'wheat', 'furs', 'cotton', 'coats', 'cigars', 'rum'];

/** What a nation's lands yield (it sells you) and what it covets (it will buy). */
export function tribeGoodsFor(q: number, r: number, tiles: Tile[]): { produces: GoodId[]; wants: GoodId[] } {
  const cells = [{ q, r }, ...neighbors(q, r)].filter((n) => n.q >= 0 && n.r >= 0 && n.q < MAP_W && n.r < MAP_H);
  const terrain = new Set(cells.map((c) => tiles[c.r * MAP_W + c.q].terrain));
  const nearWater = cells.some((c) => {
    const t = tiles[c.r * MAP_W + c.q].terrain;
    return t === 'ocean' || t === 'coast';
  });
  const produces: GoodId[] = ['furs'];
  if (terrain.has('grass')) produces.push('wheat');
  if (terrain.has('forest')) produces.push('lumber');
  if (terrain.has('grass') && nearWater) {
    produces.push('tobacco');
    produces.push('spices');
  }
  if (terrain.has('hills')) {
    produces.push('iron');
    produces.push('silver');
  }
  const uniq = [...new Set(produces)];
  const wants = WANT_PRIORITY.filter((g) => !uniq.includes(g));
  return { produces: uniq, wants };
}

// The land has three regions: a north coast, a west coast, and a deep south
// (the central-east is a bay). Each empire gets an open coastal corridor; its
// two nations sit on adjacent inland ground at the corridor's ends.
const SCENARIOS: Record<Owner, EmpireScenario> = {
  england: {
    startBand: B(0.06, 0.40, 0.34, 0.62),
    tribes: [
      { id: 'iroquois', name: 'Iroquois', pop: 900, claimRadius: 5, band: B(0.38, 0.60, 0.0, 0.20), nearWater: true, stance: -10, stanceRival: 0 },
      { id: 'powhatan', name: 'Powhatan', pop: 420, claimRadius: 5, band: B(0.40, 0.64, 0.80, 1.0), nearWater: false, stance: 10, stanceRival: 0 },
    ],
  },
  france: {
    startBand: B(0.08, 0.46, 0.0, 0.24),
    tribes: [
      { id: 'algonquin', name: 'Algonquin', pop: 600, claimRadius: 5, band: B(0.48, 0.62, 0.0, 0.24), nearWater: true, stance: 5, stanceRival: 0 },
      { id: 'huron', name: 'Huron', pop: 800, claimRadius: 5, band: B(0.20, 0.46, 0.70, 0.90), nearWater: false, stance: -5, stanceRival: 0 },
    ],
  },
  netherlands: {
    startBand: B(0.28, 0.60, 0.0, 0.26),
    tribes: [
      { id: 'lenape', name: 'Lenape', pop: 700, claimRadius: 5, band: B(0.06, 0.28, 0.38, 0.62), nearWater: true, stance: 10, stanceRival: 0 },
      { id: 'mohican', name: 'Mohican', pop: 650, claimRadius: 5, band: B(0.46, 0.72, 0.76, 0.96), nearWater: false, stance: 0, stanceRival: 0 },
    ],
  },
  sweden: {
    startBand: B(0.06, 0.40, 0.52, 0.80),
    tribes: [
      { id: 'susquehannock', name: 'Susquehannock', pop: 750, claimRadius: 5, band: B(0.34, 0.60, 0.82, 1.0), nearWater: false, stance: -10, stanceRival: 0 },
      { id: 'nanticoke', name: 'Nanticoke', pop: 400, claimRadius: 4, band: B(0.38, 0.60, 0.0, 0.20), nearWater: true, stance: 5, stanceRival: 0 },
    ],
  },
  spain: {
    startBand: B(0.06, 0.52, 0.76, 0.98),
    tribes: [
      { id: 'timucua', name: 'Timucua', pop: 500, claimRadius: 5, band: B(0.44, 0.76, 0.66, 0.92), nearWater: true, stance: 5, stanceRival: 0 },
      { id: 'calusa', name: 'Calusa', pop: 300, claimRadius: 4, band: B(0.30, 0.55, 0.50, 0.72), nearWater: false, stance: -5, stanceRival: 0 },
    ],
  },
  portugal: {
    startBand: B(0.36, 0.52, 0.70, 0.92),
    tribes: [
      { id: 'apalachee', name: 'Apalachee', pop: 550, claimRadius: 4, band: B(0.64, 0.86, 0.76, 0.98), nearWater: false, stance: 5, stanceRival: 0 },
      { id: 'creek', name: 'Creek', pop: 700, claimRadius: 4, band: B(0.06, 0.24, 0.70, 0.92), nearWater: false, stance: -5, stanceRival: 0 },
    ],
  },
  denmark: {
    startBand: B(0.06, 0.40, 0.62, 0.94),
    tribes: [
      { id: 'taino', name: 'Taíno', pop: 480, claimRadius: 4, band: B(0.0, 0.22, 0.80, 1.0), nearWater: true, stance: 10, stanceRival: 0 },
      { id: 'carib', name: 'Carib', pop: 420, claimRadius: 5, band: B(0.06, 0.28, 0.34, 0.56), nearWater: true, stance: -5, stanceRival: 0 },
    ],
  },
  prussia: {
    startBand: B(0.04, 0.32, 0.26, 0.50),
    tribes: [
      { id: 'patuxent', name: 'Patuxent', pop: 460, claimRadius: 4, band: B(0.04, 0.28, 0.10, 0.26), nearWater: true, stance: 5, stanceRival: 0 },
      { id: 'rappahannock', name: 'Rappahannock', pop: 520, claimRadius: 4, band: B(0.10, 0.34, 0.60, 0.78), nearWater: false, stance: -5, stanceRival: 0 },
    ],
  },
  russia: {
    startBand: B(0.38, 0.60, 0.0, 0.14),
    tribes: [
      { id: 'mikmaq', name: "Mi'kmaq", pop: 600, claimRadius: 4, band: B(0.26, 0.44, 0.0, 0.20), nearWater: true, stance: 0, stanceRival: 0 },
      { id: 'beothuk', name: 'Beothuk', pop: 350, claimRadius: 4, band: B(0.62, 0.84, 0.0, 0.18), nearWater: true, stance: -5, stanceRival: 0 },
    ],
  },
};

export function createGame(seed: number, player: Owner = 'england', rivalCount: number = 1): GameState {
  const base = mulberry32(seed);
  let rngCalls = 0;
  const rng = (): number => {
    rngCalls++;
    return base();
  };
  const tiles = generateTiles(rng);
  const allEmpires = Object.keys(EMPIRE_NAMES) as Owner[];

  // Deterministic rival roster: the player's designated rival first, then the rest in roster order.
  const want = Math.max(1, Math.min(rivalCount, allEmpires.length - 1));
  const ordered = [RIVAL_OF[player], ...allEmpires.filter((e) => e !== player && e !== RIVAL_OF[player])];
  const rivals = ordered.slice(0, want);
  const owners = [player, ...rivals];

  // The board's peoples are the player's two regional nations; every rival crown courts them.
  const tribeDefs: Array<TribeDef & { owner: Owner }> = SCENARIOS[player].tribes.map((td) => ({ ...td, owner: player }));

  // Spread tribe homes apart so a crowded board does not wall in the colonists.
  const placedTribes: Array<{ q: number; r: number; claimRadius: number }> = [];
  const tribeHomes = tribeDefs.map((td) => {
    const cands = tiles.filter(
      (t) =>
        isLand(t.terrain) &&
        td.band(t) &&
        (!td.nearWater ||
          neighbors(t.q, t.r).some((n) => {
            if (n.q < 0 || n.r < 0 || n.q >= MAP_W || n.r >= MAP_H) return false;
            const nt = tiles[n.r * MAP_W + n.q];
            return nt && (nt.terrain === 'ocean' || nt.terrain === 'coast');
          })),
    );
    const list = cands.length > 0 ? cands : tiles.filter((t) => isLand(t.terrain));
    let best = list[0];
    let bestScore = -Infinity;
    for (const c of list) {
      let minClear = 1000;
      for (const p of placedTribes) minClear = Math.min(minClear, hexDist(c.q, c.r, p.q, p.r) - p.claimRadius);
      let score = minClear;
      // Keep every empire's home corridor clear: a nation inside a start band walls it in.
      for (const o of owners) {
        if (SCENARIOS[o].startBand(c)) score -= 120;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    placedTribes.push({ q: best.q, r: best.r, claimRadius: td.claimRadius });
    return { td, home: best };
  });
  const claims = placedTribes;

  const playerStart =
    findStart(tiles, claims, (t) => isSettleable(t.terrain) && SCENARIOS[player].startBand(t) && t.terrain === 'grass' && isCoastalIn(tiles, t.q, t.r)) ??
    findStart(tiles, claims, (t) => isSettleable(t.terrain) && SCENARIOS[player].startBand(t) && isCoastalIn(tiles, t.q, t.r)) ??
    fallbackLand(tiles);

  const starts: Partial<Record<Owner, { q: number; r: number }>> = { [player]: { q: playerStart.q, r: playerStart.r } };
  const placedStarts: Array<{ q: number; r: number }> = [playerStart];
  for (const r of rivals) {
    const rsc = SCENARIOS[r];
    // Pick the band tile that is as far as possible from every other crown — maximise separation.
    const cands = tiles.filter(
      (t) => isSettleable(t.terrain) && rsc.startBand(t) &&
        claims.every((cl) => hexDist(t.q, t.r, cl.q, cl.r) > cl.claimRadius + 1),
    );
    let best: Tile | null = null;
    let bestSep = -1;
    for (const c of cands) {
      const sep = Math.min(...placedStarts.map((ps) => hexDist(c.q, c.r, ps.q, ps.r)));
      const preferCoast = c.terrain === 'grass' && isCoastalIn(tiles, c.q, c.r) ? 0.5 : 0;
      if (sep + preferCoast > bestSep) {
        bestSep = sep + preferCoast;
        best = c;
      }
    }
    const st = best ?? fallbackLand(tiles);
    starts[r] = { q: st.q, r: st.r };
    placedStarts.push(st);
  }

  const tribes: Tribe[] = tribeHomes.map((p) => {
    const stance = {} as Record<Owner, number>;
    const trade = {} as Record<Owner, boolean>;
    const contact = {} as Record<Owner, boolean>;
    for (const o of owners) {
      stance[o] = o === p.td.owner ? p.td.stance : 0;
      if (o === 'france') stance[o] += 15;
      trade[o] = false;
      contact[o] = false;
    }
    const { produces, wants } = tribeGoodsFor(p.home.q, p.home.r, tiles);
    return {
      id: p.td.id, name: p.td.name, q: p.home.q, r: p.home.r,
      pop: p.td.pop, popStart: p.td.pop,
      stance, trade, contact,
      claimRadius: p.td.claimRadius,
      alliance: 'none',
      allianceOffered: false,
      produces, wants,
      homeQ: p.home.q,
      homeR: p.home.r,
      followUp: null,
      immuneUntil: 0,
      followUpIn: null,
      demand: rollDemand(wants, rng),
      demandTurns: 8 + Math.floor(rng() * 9),
      demandsFulfilled: 0,
    };
  });

  const treasury = Object.fromEntries(allEmpires.map((e) => [e, 0])) as Record<Owner, number>;
  for (const o of owners) treasury[o] = 100 + (o === 'spain' ? 50 : 0);
  const income = Object.fromEntries(allEmpires.map((e) => [e, 0])) as Record<Owner, number>;
  const insight = Object.fromEntries(allEmpires.map((e) => [e, 0])) as Record<Owner, number>;
  const researched = Object.fromEntries(allEmpires.map((e) => [e, [] as string[]])) as Record<Owner, string[]>;

  const units: Unit[] = [];
  let unitId = 1;
  for (const o of owners) {
    const st = starts[o]!;
    for (let k = 0; k < 3; k++) {
      units.push({ id: unitId++, owner: o, kind: 'settler', q: st.q, r: st.r, moveLeft: SETTLED_MOVEMENT, bombardedThisTurn: false });
    }
  }

  /** Per-good map from the GOODS table. */
  const goodsOf = (fn: (g: (typeof GOODS)[number]) => number): Record<GoodId, number> =>
    Object.fromEntries(GOODS.map((g) => [g.id, fn(g)])) as Record<GoodId, number>;
  const ownerGoods = (fn: (g: (typeof GOODS)[number]) => number): Record<Owner, Record<GoodId, number>> =>
    Object.fromEntries(allEmpires.map((o) => [o, goodsOf(fn)])) as Record<Owner, Record<GoodId, number>>;

  const s: GameState = {
    seed,
    player,
    rivals,
    turn: 0,
    year: START_YEAR,
    season: 0,
    rng,
    rngCalls,
    mapW: MAP_W,
    mapH: MAP_H,
    tiles,
    towns: [],
    nextTownId: 1,
    tribes,
    ships: [],
    nextShipId: 1,
    units,
    nextUnitId: unitId,
    treasury,
    income,
    firstExport: false,
    exportValue: 0,
    prices: goodsOf((g) => g.base),
    prevPrices: goodsOf((g) => g.base),
    supply: ownerGoods(() => 0),
    sellP: ownerGoods((g) => g.base),
    buyP: ownerGoods((g) => g.base + g.market.spread),
    events: [],
    pendingEvents: [],
    nextEventId: 1,
    log: ['1607 — Three ships put into the bay. Three settlers step ashore. Select one to begin.'],
    defiance: 0,
    embargoNoted: false,
    taxRate: 10,
    taxesPaid: 0,
    tradeSevered: false,
    warActive: false,
      roads: [],
      roadWork: [],
    warTurns: 0,
    refIn: 0,
    wavesFired: 0,
    navActPassed: false,
    visited: false,
    garrison: null,
    garrisonsSent: 0,
    occupations: [],
    occupationsTaken: 0,
    era: 1,
    insight,
    researched,
    founders: Object.fromEntries(allEmpires.map((o) => [o, [] as string[]])) as Record<Owner, string[]>,
    skills: Object.fromEntries(allEmpires.map((o) => [o, [] as string[]])) as unknown as Record<Owner, string[]>,
    victory: null,
    playerStart: { q: playerStart.q, r: playerStart.r },
    outbreaks: [],
    nextOutbreakId: 1,
    explored: [],
    visible: [],
  };
  s.rng = (): number => {
    s.rngCalls++;
    return rng();
  };
  recomputeVisibility(s);
  return s;
}

const SAVE_KEY = 'newcol-save-v16';

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveGame(s: GameState): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}

export function loadGame(): GameState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as GameState;
    if (obj.season == null) obj.season = 0;
    if (!obj.explored || !obj.visible) recomputeVisibility(obj);
    // Pre-v10 saves have no per-owner Europe markets — seed them at base prices.
    for (const tw of obj.towns ?? []) for (const g of GOODS) if (tw.stock[g.id] == null) tw.stock[g.id] = 0;
    for (const tr of obj.tribes ?? []) {
      if (!tr.demand) { tr.demand = rollDemand(tr.wants ?? [], mulberry32(obj.seed)); tr.demandTurns = 10; tr.demandsFulfilled = 0; }
    }
    for (const tw of obj.towns ?? []) if (!tw.landBought) tw.landBought = [];
    for (const tw of obj.towns ?? []) if (tw.seasonGross == null) tw.seasonGross = 0;
    if (!obj.skills) obj.skills = Object.fromEntries(Object.keys(EMPIRE_NAMES).map((o) => [o, []])) as unknown as GameState['skills'];
    if (!obj.founders) obj.founders = Object.fromEntries(Object.keys(EMPIRE_NAMES).map((o) => [o, []])) as unknown as GameState["founders"];
    if (obj.taxRate == null) { obj.taxRate = 10; obj.taxesPaid = 0; obj.tradeSevered = false; obj.warActive = false; obj.warTurns = 0; obj.refIn = 0; obj.wavesFired = 0; }
    if (!obj.roads) obj.roads = [];
    if (!obj.roadWork) obj.roadWork = [];
    if (!obj.supply) {
      const gmap = (fn: (g: (typeof GOODS)[number]) => number): Record<GoodId, number> =>
        Object.fromEntries(GOODS.map((g) => [g.id, fn(g)])) as Record<GoodId, number>;
      const owners = Object.keys(EMPIRE_NAMES) as Owner[];
      obj.supply = Object.fromEntries(owners.map((o) => [o, gmap(() => 0)])) as GameState['supply'];
      obj.sellP = Object.fromEntries(owners.map((o) => [o, gmap((g) => g.base)])) as GameState['sellP'];
      obj.buyP = Object.fromEntries(owners.map((o) => [o, gmap((g) => g.base + g.market.spread)])) as GameState['buyP'];
    }
    const replay = mulberry32(obj.seed);
    for (let i = 0; i < (obj.rngCalls ?? 0); i++) replay();
    obj.rng = (): number => {
      obj.rngCalls++;
      return replay();
    };
    return obj;
  } catch {
    return null;
  }
}

function isCoastalIn(tiles: Tile[], q: number, r: number): boolean {
  return neighbors(q, r).some((n) => {
    if (n.q < 0 || n.r < 0 || n.q >= MAP_W || n.r >= MAP_H) return false;
    const t = tiles[n.r * MAP_W + n.q];
    return t && (t.terrain === 'ocean' || t.terrain === 'coast');
  });
}

export function townAt(s: GameState, q: number, r: number): Town | null {
  return s.towns.find((t) => t.q === q && t.r === r) ?? null;
}

export function pushEvent(s: GameState, e: Omit<GameEvent, 'id' | 'year'>): void {
  const ev: GameEvent = { ...e, id: s.nextEventId++, year: s.year };
  s.events.push(ev);
  s.log.unshift(`${s.year} — ${ev.title}`);
  if (s.log.length > 30) s.log.pop();
  if (ev.choices) s.pendingEvents.push(ev);
}

export function eventChoice(s: GameState, eventId: number, idx: number): boolean {
  const i = s.pendingEvents.findIndex((e) => e.id === eventId);
  if (i < 0) return false;
  const ev = s.pendingEvents[i];
  if (!ev.choices || idx < 0 || idx >= ev.choices.length) return false;
  s.pendingEvents.splice(i, 1);
  applyChoice(s, ev, idx);
  return true;
}

function applyChoice(s: GameState, ev: GameEvent, idx: number): void {
  switch (ev.kind) {
    case 'tax': {
      const rate = ev.data ?? Math.min(75, s.taxRate + 10);
      if (idx === 0) {
        s.taxRate = rate;
        for (const t of s.towns) if (t.owner === s.player) t.loyalty = clamp(t.loyalty - 4, 0, 100);
        s.log.unshift(`${s.year} — The colony grits its teeth and pays the King's ${rate}%. The ledger is written — and spent on redcoats.`);
      } else if (idx === 1) {
        const lump = 30 + s.taxRate;
        s.treasury[s.player] = Math.max(0, s.treasury[s.player] - lump);
        s.taxesPaid += lump;
        s.log.unshift(`${s.year} — £${lump} remitted as a gift for the fleet; the duty stands at ${s.taxRate}%.`);
      } else {
        s.tradeSevered = true;
        s.defiance++;
        for (const t of s.towns) if (t.owner === s.player) t.loyalty = clamp(t.loyalty - 8, 0, 100);
        s.log.unshift(`${s.year} — The ports stand empty to the mother country. The King will count this as rebellion.`);
        if (s.defiance >= 2 && !s.visited) {
          s.visited = true;
          s.defiance = 0;
          pushEvent(s, {
            kind: 'visit',
            title: 'A Royal Visitor',
            body:
              'The Crown has noticed your refusals. A royal commissioner sails in to inspect the colony, ' +
              'his letters sealed and his men armed. The towns wait to see what you will do.',
            choices: [
              { label: 'Submit (costs £50)', hint: '+15 loyalty, the storm passes' },
              { label: 'Defy the Crown', hint: '−15 loyalty everywhere — the roads to independence open' },
            ],
          });
        }
      }
      break;
    }
    case 'contact': {
      const tri = s.tribes[ev.data ?? 0] ?? s.tribes[0];
      if (tri) {
        const warm = idx === 0;
        if (warm) {
          s.treasury[s.player] -= 25;
          tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) + 15, -100, 100);
          s.log.unshift(`${s.year} — You send a greeting party to the ${tri.name} with gifts of trade. The meeting is warm — for now.`);
        } else {
          tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) - 10, -100, 100);
          s.log.unshift(`${s.year} — You hold your lines as the ${tri.name} braves pass. The meeting is cold, and it will be remembered.`);
        }
        // What follows a meeting is not always the same. A warm welcome lowers the odds of the fever.
        const roll = s.rng();
        const plagueChance = warm ? 0.35 : 0.65;
        const caravanChance = warm ? 0.4 : 0.15;
        tri.followUp = roll < plagueChance ? 'plague' : roll < plagueChance + caravanChance ? 'caravan' : 'council';
        tri.followUpIn = 2;
      }
      break;
    }
    case 'plague': {
      const tri = s.tribes[ev.data ?? 0] ?? s.tribes[0];
      if (tri) {
        tri.followUp = null;
        tri.followUpIn = null;
        tri.immuneUntil = s.turn + OUTBREAK_IMMUNITY;
      }
      if (idx === 0) {
        s.treasury[s.player] -= 25;
        tri.pop = Math.round(tri.pop * 0.65);
        tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) + 15, -100, 100);
        s.log.unshift(`${s.year} — You share what little medicine you have. The ${tri.name} remember it. Still, the fever takes a third of their people.`);
      } else {
        tri.pop = Math.round(tri.pop * 0.4);
        tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) - 35, -100, 100);
        s.log.unshift(`${s.year} — The fever runs its course unaided. More than half the ${tri.name} are gone. What is left will not forget the silence.`);
      }
      break;
    }
    case 'outbreak': {
      const key = ev.settlement ?? null;
      const town = key && key.startsWith('t:') ? s.towns.find((t) => t.id === Number(key.slice(2))) : undefined;
      // Ignore an outbreak in a town that is no longer ours (captured before the choice was made).
      if (town && town.owner === s.player) {
        const quarantined = idx === 0 && s.treasury[s.player] >= QUARANTINE_COST;
        if (quarantined) s.treasury[s.player] -= QUARANTINE_COST;
        const mortality = quarantined ? TOWN_MORTALITY * 0.5 : TOWN_MORTALITY;
        const before = town.pop;
        town.pop = Math.max(1, Math.round(town.pop * (1 - mortality)));
        const lost = before - town.pop;
        s.log.unshift(
          `${s.year} — The sickness takes ${lost} of the people of ${town.name}. ` +
          (quarantined ? 'The quarantine and the physic hold the worst of it back. ' : 'There was little anyone could do. '),
        );
      }
      break;
    }
    case 'caravan': {
      const tri = s.tribes[ev.data ?? 0] ?? s.tribes[0];
      if (tri) {
        tri.followUp = null;
        tri.followUpIn = null;
        tri.trade[s.player] = true;
        let bounty = 0;
        for (const g of tri.produces) bounty += s.prices[g];
        s.treasury[s.player] += bounty;
        tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) + 8, -100, 100);
        s.log.unshift(`${s.year} — A ${tri.name} trade caravan sets a regular route with the colony. From now on they will trade with you each season.`);
      }
      break;
    }
    case 'council': {
      const tri = s.tribes[ev.data ?? 0] ?? s.tribes[0];
      if (tri) {
        tri.followUp = null;
        tri.followUpIn = null;
        if (idx === 0) {
          s.treasury[s.player] -= 30;
          tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) + 20, -100, 100);
          s.log.unshift(`${s.year} — You send tribute to the ${tri.name} council. They are pleased, and your name is spoken well.`);
        } else {
          tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) - 8, -100, 100);
          s.log.unshift(`${s.year} — You decline the ${tri.name} council's request. They do not press it, but it is noted.`);
        }
      }
      break;
    }
    case 'era': {
      s.log.unshift(`${s.year} — ${ev.title}. The colony takes the new age in stride, and gets to work.`);
      break;
    }
    case 'alliance': {
      const tri = s.tribes[ev.data ?? 0];
      if (tri) {
        if (idx === 0) {
          tri.alliance = s.player;
          s.log.unshift(`${s.year} — Wampum accepted, treaties spoken. The ${tri.name} warriors stand with the colony.`);
        } else {
          s.log.unshift(`${s.year} — The offer is declined, courteously. The ${tri.name} take it in stride — for now.`);
        }
      }
      break;
    }
    case 'troops': {
      if (idx === 0) {
        if (s.garrison) {
          s.treasury[s.player] -= 100;
          s.garrison = null;
          s.defiance = Math.max(0, s.defiance - 1);
          s.log.unshift(`${s.year} — A fine of £100 is paid and the regiment is recalled. London takes the money and its grudge.`);
        }
      } else {
        s.log.unshift(`${s.year} — "Let them come." The men drill on the ramparts and the blacksmiths work the night shift.`);
      }
      break;
    }
    case 'visit': {
      if (idx === 0) {
        s.treasury[s.player] -= 50;
        for (const t of s.towns) if (t.owner === s.player) t.loyalty = clamp(t.loyalty + 15, 0, 100);
        s.log.unshift(`${s.year} — You kneel. The commissioner departs, his ledger balanced, his opinion of you noted.`);
      } else {
        for (const t of s.towns) if (t.owner === s.player) t.loyalty = clamp(t.loyalty - 15, 0, 100);
        s.defiance = 3;
        s.log.unshift(`${s.year} — "No king crosses that sea to tell us how to govern." The commissioner leaves with his seal unbroken and his anger intact. He writes a long letter to London.`);
      }
      break;
    }
    default:
      break;
  }
}
