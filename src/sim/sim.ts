import { chance, clamp } from './rng';
import {
  GOODS, GOOD_BY_ID, IMPROVEMENTS, SETTLED_MOVEMENT, SETTLER_COST, MILITIA_COST, TRAIN_COST,
  VOYAGE_TURNS, SHIP_CARGO_CAP, STORAGE_CAP, SALES_CAP, SALES_CAP_CUSTOM,
  ERA_II_YEAR, ERA_III_YEAR, FRIGATE_MOVEMENT, FRIGATE_COST, SEASONS_PER_YEAR,
  EMPIRE_NAMES, DEMOS, SIGNATURE_GOOD, crownDutyFor, fortCostFor, fortDefenseFor, exportBonusFor, growthBonusFor,
  militiaCostFor, militiaDefenseFor, famineLossFor,
} from './goods';
import { TECHS } from './techs';
import { FOUNDERS } from './founders';
import type { Era, Season } from './goods';
import { START_YEAR, tileAt, townAt, pushEvent, isCoastal, isWaterfront, isSettleable, isLand, newTownName, inStartBand, recomputeVisibility, rollDemand , DISEASE_NAMES, TOWN_MORTALITY, TRIBAL_MORTALITY, OUTBREAK_SPREAD_RADIUS, OUTBREAK_DURATION, OUTBREAK_IMMUNITY, QUARANTINE_COST } from './state';
import type {
  DeclareKind, GameState, GoodId, ImprovementId, Owner, Town, Tribe, Unit, UnitKind,
} from './types';
import { hexDist, neighbors } from './hex';

export const NAV_ACT_YEAR = 1660;
export const TAX_INTERVAL = 12;
export const TAX_START_YEAR = 1619;
export const CHARTER_COST = 30;
export const CROWN_DUTY = 0.5;
export const LOCAL_TRADE = 4;
export { SETTLED_MOVEMENT, SETTLER_COST, MILITIA_COST, TRAIN_COST } from './goods';

const has = (t: Town, imp: ImprovementId) => t.improvements.includes(imp);

const ownerTechs = (s: GameState, owner: Owner): string[] => s.researched[owner] ?? [];
export const hasTech = (s: GameState, owner: Owner, id: string): boolean => ownerTechs(s, owner).includes(id);
export const allOwners = (s: GameState): Owner[] => [s.player, ...s.rivals];

export const hasFounder = (s: GameState, owner: Owner, id: string): boolean => (s.founders[owner] ?? []).includes(id);
export const hasSkill = (s: GameState, owner: Owner, id: string): boolean => (s.skills[owner] ?? []).includes(id);
/** What one of your towns actually pays for a fort, founders included. */
export const fortCost = (s: GameState, owner: Owner): number => Math.max(40, fortCostFor(owner) - (hasFounder(s, owner, 'montcalm') ? 25 : 0));
export const frigateCost = (s: GameState, owner: Owner): number => FRIGATE_COST - (hasFounder(s, owner, 'shipwright') ? 15 : 0);
export const exportBonusPct = (s: GameState, owner: Owner): number => exportBonusFor(owner) + (hasFounder(s, owner, 'frontenac') ? 0.1 : 0);
export const wagonTollPct = (s: GameState, owner: Owner): number => WAGON_TOLL * (hasFounder(s, owner, 'stuyvesant') ? 0.5 : 1);

/** Defiance at which the Crown imposes a trade embargo (arrivals pay half). */
export const EMBARGO_DEFIANCE = 4;
/** Turns (seasons) between hunting migrations — the nations follow the game once a year. */
export const HUNT_INTERVAL = 4;

// ---------- disease outbreaks ----------
interface Settlement {
  key: string; q: number; r: number; name: string; isTown: boolean; owner?: Owner; immuneUntil: number;
}

function settlements(s: GameState): Settlement[] {
  const out: Settlement[] = [];
  for (const t of s.towns) out.push({ key: `t:${t.id}`, q: t.q, r: t.r, name: t.name, isTown: true, owner: t.owner, immuneUntil: t.immuneUntil });
  s.tribes.forEach((tr, i) => out.push({ key: `g:${i}`, q: tr.q, r: tr.r, name: tr.name, isTown: false, immuneUntil: tr.immuneUntil }));
  return out;
}

/** Resolve a settlement key ('t:{id}' | 'g:{idx}') directly — no list rebuild. */
function settlementAt(s: GameState, key: string): Settlement | undefined {
  if (key.startsWith('t:')) {
    const t = s.towns.find((x) => x.id === Number(key.slice(2)));
    return t && { key, q: t.q, r: t.r, name: t.name, isTown: true, owner: t.owner, immuneUntil: t.immuneUntil };
  }
  if (key.startsWith('g:')) {
    const tri = s.tribes[Number(key.slice(2))];
    return tri && { key, q: tri.q, r: tri.r, name: tri.name, isTown: false, immuneUntil: tri.immuneUntil };
  }
  return undefined;
}

/** Whether the player can legitimately know this settlement's identity (fog of war). */
function settlementKnown(s: GameState, st: Settlement): boolean {
  if (st.isTown && st.owner === s.player) return true;
  if (s.visible[st.r * s.mapW + st.q]) return true;
  if (!st.isTown) {
    const tri = s.tribes[Number(st.key.slice(2))];
    if (tri && (tri.contact[s.player] || tri.alliance === s.player)) return true;
  }
  return false;
}

/** A name the player may hear in the log — 'a settlement' for places they've never laid eyes on. */
function knownName(s: GameState, st: Settlement): string {
  if (settlementKnown(s, st)) return st.name;
  return st.isTown ? 'a distant settlement' : 'a native village beyond your sight';
}

/** Take the toll of an outbreak on one settlement. Player towns get a choice; the rest suffer it at once.
 *  Survivors are immune for a few years: an immune settlement is left alone. */
function dealMortality(s: GameState, key: string, name: string): void {
  const isTown = key.startsWith('t:');
  if (isTown) {
    const t = s.towns.find((x) => x.id === Number(key.slice(2)));
    if (!t || s.turn < t.immuneUntil) return;
    t.immuneUntil = s.turn + OUTBREAK_IMMUNITY;
    if (t.owner === s.player) {
      pushEvent(s, {
        kind: 'outbreak',
        title: `${name} in ${t.name}`,
        body:
          `${name} has found its way into ${t.name}. The sick are carried out at dawn and the water is watched. ` +
          `Spend on quarantine and physic to halve the toll, or let the sickness take what it will.`,
        settlement: key,
        choices: [
          { label: `Quarantine the town (costs £${QUARANTINE_COST})`, hint: 'Halves the deaths' },
          { label: 'There is nothing to be done', hint: 'The full toll is taken' },
        ],
      });
    } else {
      const before = t.pop;
      t.pop = Math.max(1, Math.round(t.pop * (1 - TOWN_MORTALITY)));
      s.log.unshift(`${s.year} — ${name} strikes ${knownName(s, settlementAt(s, key)!)}; ${before - t.pop} of the people are lost.`);
    }
  } else {
    const tri = s.tribes[Number(key.slice(2))];
    if (!tri || s.turn < tri.immuneUntil) return;
    tri.immuneUntil = s.turn + OUTBREAK_IMMUNITY;
    const before = tri.pop;
    tri.pop = Math.max(1, Math.round(tri.pop * (1 - TRIBAL_MORTALITY)));
    s.log.unshift(`${s.year} — ${name} moves through the camps of ${knownName(s, settlementAt(s, key)!)}; ${before - tri.pop} of the people do not survive.`);
  }
}

/** Begin a new outbreak at a settlement. It does not spread until the turn after it starts. */
export function seedOutbreak(s: GameState, sourceKey: string, name?: string, infectSource = true): void {
  const nm = name ?? DISEASE_NAMES[Math.floor(s.rng() * DISEASE_NAMES.length)];
  s.outbreaks.push({ id: s.nextOutbreakId++, name: nm, age: 0, duration: OUTBREAK_DURATION, source: sourceKey, reached: [sourceKey] });
  const st = settlementAt(s, sourceKey);
  s.log.unshift(`${s.year} — ${nm} takes hold in ${st ? knownName(s, st) : 'a settlement'}.`);
  if (infectSource) dealMortality(s, sourceKey, nm);
}

/** Each turn, every active outbreak ages and hops to the nearest uninfected, non-immune settlement it can reach. */
function processOutbreaks(s: GameState): void {
  if (s.outbreaks.length === 0) return;
  const all = settlements(s);
  const still: typeof s.outbreaks = [];
  for (const ob of s.outbreaks) {
    const fresh = ob.age === 0; // seeded this very turn — the fever has not had time to travel
    ob.age++;
    if (ob.age >= ob.duration) {
      s.log.unshift(`${s.year} — ${ob.name} finally runs its course.`);
      continue;
    }
    if (!fresh) {
      const last = settlementAt(s, ob.reached[ob.reached.length - 1]);
      if (last) {
        const cands = all.filter((x) =>
          !ob.reached.includes(x.key) &&
          s.turn >= x.immuneUntil &&
          hexDist(x.q, x.r, last.q, last.r) <= OUTBREAK_SPREAD_RADIUS);
        if (cands.length > 0) {
          const minD = Math.min(...cands.map((x) => hexDist(x.q, x.r, last.q, last.r)));
          const near = cands.filter((x) => hexDist(x.q, x.r, last.q, last.r) <= minD + 1);
          const pick = near[Math.floor(s.rng() * near.length)];
          ob.reached.push(pick.key);
          s.log.unshift(`${s.year} — ${ob.name} spreads to ${knownName(s, pick)}.`);
          dealMortality(s, pick.key, ob.name);
        }
      }
    }
    still.push(ob);
  }
  s.outbreaks = still;
}
/** The Crown's duty on a ship's cargo — it climbs as the colony's defiance grows. */
export function effectiveDuty(s: GameState, owner: Owner): number {
  if (owner === s.player) return s.taxRate / 100;
  return crownDutyFor(owner);
}

/** Effective era gate for an improvement — Fine Gunpowder pulls artillery forward to the Age of Trade. */
export function improvementEraFor(s: GameState, owner: Owner, imp: ImprovementId): 1 | 2 | 3 {
  if (imp === 'artillery' && hasTech(s, owner, 'powder')) return 2;
  return IMPROVEMENTS[imp].era;
}

export function buyTech(s: GameState, id: string): string | null {
  const tech = TECHS.find((t) => t.id === id);
  if (!tech) return 'Unknown research.';
  const mine = s.researched[s.player] ?? (s.researched[s.player] = []);
  if (mine.includes(id)) return 'Already mastered.';
  if (s.era < tech.era) return 'That craft is not yet available in this age.';
  const pool = s.insight[s.player] ?? 0;
  if (pool < tech.cost) return `Not enough insight (${tech.cost} needed).`;
  s.insight[s.player] = pool - tech.cost;
  mine.push(id);
  pushEvent(s, { kind: 'info', title: 'New Learning', body: `${tech.name} is put to use across the colonies. ${tech.desc}` });
  s.log.unshift(`${s.year} — ${EMPIRE_NAMES[s.player]} masters ${tech.name}.`);
  return null;
}

export function buyFounder(s: GameState, id: string): string | null {
  const f = FOUNDERS.find((x) => x.id === id);
  if (!f) return 'No such founder answers that name.';
  const mine = s.founders[s.player] ?? (s.founders[s.player] = []);
  if (mine.includes(id)) return 'Already come ashore.';
  if (s.era < f.era) return 'Not yet — word of this colony has not reached them.';
  const pool = s.insight[s.player] ?? 0;
  if (pool < f.cost) return `Not enough insight (${f.cost} needed).`;
  s.insight[s.player] = pool - f.cost;
  mine.push(id);
  pushEvent(s, { kind: 'info', title: `${f.name} Has Come Ashore`, body: `${f.desc}` });
  s.log.unshift(`${s.year} — ${f.name} lands and takes up the colony's cause.`);
  return null;
}

function generateInsight(s: GameState) {
  for (const side of allOwners(s)) {
    let gain = 0;
    for (const t of s.towns) {
      if (t.owner !== side || !t.fed) continue;
      gain += 1;
      if (has(t, 'meetinghouse')) gain += 1;
      if (has(t, 'mill')) gain += 1;
      if (hasFounder(s, side, 'harriot')) gain += 0.25;
    }
    s.insight[side] = (s.insight[side] ?? 0) + gain;
  }
}

export function terrainMoveCost(terrain: string): number {
  switch (terrain) {
    case 'grass':
    case 'forest':
    case 'coast':
      return 1;
    case 'hills':
    case 'river':
      return 2;
    default:
      return Infinity;
  }
}

export function unitsOn(s: GameState, q: number, r: number): Unit[] {
  return s.units.filter((u) => u.q === q && u.r === r);
}

function stepCost(s: GameState, u: Unit, q: number, r: number, lanes?: Set<number>): number {
  const tile = tileAt(s, q, r);
  if (!tile) return Infinity;
  if (u.kind !== 'frigate' && lanes?.has(r * s.mapW + q)) return 1;
  if (u.kind === 'frigate') {
    if (tile.terrain === 'ocean' || tile.terrain === 'coast') return 1;
    // A frigate may sit at its own port (the quay of a docked town).
    if (s.towns.some((t) => t.q === q && t.r === r && t.owner === u.owner && has(t, 'dock'))) return 1;
    return Infinity;
  }
  if (u.kind === 'ranger' && (tile.terrain === 'forest' || tile.terrain === 'hills' || tile.terrain === 'river')) return 1;
  return terrainMoveCost(tile.terrain);
}

export function reachableTiles(s: GameState, u: Unit): Array<{ q: number; r: number; cost: number }> {
  const lanes = roadTilesFor(s, u.owner);
  const dist = new Map<number, number>();
  const key = (q: number, r: number) => r * 1000 + q;
  dist.set(key(u.q, u.r), 0);
  const frontier: Array<{ q: number; r: number; cost: number }> = [{ q: u.q, r: u.r, cost: 0 }];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    const curCost = dist.get(key(cur.q, cur.r))!;
    if (curCost < cur.cost) continue;
    for (const n of neighbors(cur.q, cur.r)) {
      const tile = tileAt(s, n.q, n.r);
      if (!tile) continue;
      const step = stepCost(s, u, n.q, n.r, lanes);
    if (!isFinite(step) || step > u.moveLeft) continue;
      if (!isFinite(step)) continue;
      const nc = curCost + step;
      if (nc > u.moveLeft) continue;
      const k = key(n.q, n.r);
      if (nc < (dist.get(k) ?? Infinity)) {
        dist.set(k, nc);
        frontier.push({ q: n.q, r: n.r, cost: nc });
      }
    }
  }
  const out: Array<{ q: number; r: number; cost: number }> = [];
  for (const [k, cost] of dist) {
    const q = k % 1000;
    const r = Math.floor(k / 1000);
    if (q !== u.q || r !== u.r) out.push({ q, r, cost });
  }
  return out;
}

export function nextStepToward(
  s: GameState,
  u: Unit,
  q: number,
  r: number,
): { q: number; r: number } | null {
  if (u.moveLeft <= 0) return null;
  const lanes = roadTilesFor(s, u.owner);
  const key = (a: number, b: number) => b * 1000 + a;
  const dist = new Map<number, number>();
  dist.set(key(q, r), 0);
  dist.set(key(u.q, u.r), 0);
  const frontier: Array<{ q: number; r: number; cost: number }> = [{ q, r, cost: 0 }, { q: u.q, r: u.r, cost: 0 }];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    const curCost = dist.get(key(cur.q, cur.r))!;
    if (curCost < cur.cost) continue;
    for (const n of neighbors(cur.q, cur.r)) {
      const tile = tileAt(s, n.q, n.r);
      if (!tile) continue;
      const step = stepCost(s, u, n.q, n.r, lanes);
    if (!isFinite(step) || step > u.moveLeft) continue;
      if (!isFinite(step)) continue;
      const nc = curCost + step;
      const k = key(n.q, n.r);
      if (nc < (dist.get(k) ?? Infinity)) {
        dist.set(k, nc);
        frontier.push({ q: n.q, r: n.r, cost: nc });
      }
    }
  }
  const total = dist.get(key(u.q, u.r));
  if (total === undefined || total > u.moveLeft) return null;
  let best: { q: number; r: number } | null = null;
  let bestVal = Infinity;
  for (const n of neighbors(u.q, u.r)) {
    const tile = tileAt(s, n.q, n.r);
    if (!tile) continue;
    const step = stepCost(s, u, n.q, n.r, lanes);
    if (!isFinite(step) || step > u.moveLeft) continue;
    const val = step + (dist.get(key(n.q, n.r)) ?? Infinity);
    if (val < bestVal) {
      bestVal = val;
      best = n;
    }
  }
  return best;
}

export function moveUnit(s: GameState, unitId: number, q: number, r: number): string | null {
  const u = s.units.find((x) => x.id === unitId);
  if (!u) return 'No such settler.';
  if (u.q === q && u.r === r) return 'Already there.';
  const tile = tileAt(s, q, r);
  if (!tile) return 'Out of bounds.';
  if (!isFinite(stepCost(s, u, q, r, roadTilesFor(s, u.owner)))) return u.kind === 'frigate' ? 'The frigate cannot run aground on land — it may only return to its own port.' : 'They cannot walk there.';
  const reach = reachableTiles(s, u).find((x) => x.q === q && x.r === r);
  if (!reach) return 'Too far this turn.';

  if (u.kind === 'frigate') {
    u.q = q;
    u.r = r;
    u.moveLeft -= reach.cost;
    return null;
  }

  // Overland combat: is the destination held by hostile forces?
  const foes = s.units.filter((x) => x.q === q && x.r === r && x.owner !== u.owner && x.kind !== 'frigate');
  const town = s.towns.find((t) => t.q === q && t.r === r);
  const enemyTown = town && town.owner !== u.owner ? town : null;
  if (foes.length > 0 || enemyTown) {
    const atk = unitStrength(u);
    const def = enemyTown
      ? defenseOf(s, enemyTown)
      : foes.reduce((a, x) => a + unitStrength(x), 0);
    if (atk > def) {
      u.veterans = Math.min(2, (u.veterans ?? 0) + 1);
      s.units = s.units.filter((x) => !((x.q === q && x.r === r) && x.owner !== u.owner));
      if (enemyTown) {
        const old = enemyTown.owner;
        enemyTown.owner = u.owner;
        enemyTown.pop = Math.max(1, Math.round(enemyTown.pop * 0.8));
        enemyTown.loyalty = 50;
        enemyTown.construction = null;
        pushEvent(s, {
          kind: 'info',
          title: `${enemyTown.name} Falls`,
          body: `Your ${u.kind} storm the palisade of ${enemyTown.name} and the ${DEMOS[old]} garrison breaks. ` +
            `The colours come down and the town is yours; a handful of the people flee the streets.`,
        });
        s.log.unshift(`${s.year} — ${EMPIRE_NAMES[u.owner]} takes ${enemyTown.name} by force.`);
      } else {
        pushEvent(s, {
          kind: 'info',
          title: 'The Skirmish',
          body: `Your ${u.kind} meet the enemy on the open ground and drive them off. The field is theirs for the taking.`,
        });
        s.log.unshift(`${s.year} — A ${u.owner} ${u.kind} scatters the enemy on the open ground.`);
      }
      u.q = q;
      u.r = r;
      u.moveLeft -= reach.cost;
      return null;
    }
    // The defender holds — the attacker is cut down.
    s.units = s.units.filter((x) => x.id !== u.id);
    pushEvent(s, {
      kind: 'info',
      title: enemyTown ? `The Assault on ${enemyTown.name} Fails` : 'Repelled at the Border',
      body: enemyTown
        ? `Your ${u.kind} storm ${enemyTown.name} and break against its defence. The men are cut down; the town holds.`
        : `Your ${u.kind} fall on the enemy and are overmatched. The ground is not taken.`,
    });
    s.log.unshift(`${s.year} — A ${u.owner} ${u.kind} is destroyed in an attack${enemyTown ? ` on ${enemyTown.name}` : ''}.`);
    return `Your ${u.kind} were cut down in the assault.`;
  }

  u.q = q;
  u.r = r;
  u.moveLeft -= reach.cost;
  recomputeVisibility(s);
  return null;
}

function adjCount(s: GameState, t: Town, terrain: string): number {
  let n = 0;
  for (const nb of neighbors(t.q, t.r)) {
    const tile = tileAt(s, nb.q, nb.r);
    if (tile && tile.terrain === terrain) n++;
  }
  return n;
}

/** The original made every citizen a job slot the ground and buildings enable (docs §4).
 *  Our version: people are assigned farmers → artisans → traders by need of the slot,
 *  and each job turns a small crank: farmers add food, artisans add a workshop conversion,
 *  traders add 5% to every shipload leaving this town. */
export function jobSlots(s: GameState, t: Town): { farmer: number; artisan: number; trader: number } {
  const grass = (tileAt(s, t.q, t.r)?.terrain === 'grass' ? 1 : 0) + adjCount(s, t, 'grass');
  return {
    farmer: Math.min(4, grass),
    artisan: t.improvements.filter((i) => IMPROVEMENTS[i].manufacture).length,
    trader: has(t, 'dock') ? 2 : has(t, 'wagondepot') ? 1 : 0,
  };
}

export function jobWorkers(s: GameState, t: Town): { farmer: number; artisan: number; trader: number } {
  const slots = jobSlots(s, t);
  let left = t.pop;
  const farmer = Math.min(slots.farmer, left);
  left -= farmer;
  const artisan = Math.min(slots.artisan, left);
  left -= artisan;
  const trader = Math.min(slots.trader, left);
  return { farmer, artisan, trader };
}

function foodProd(s: GameState, t: Town): number {
  let f = 4 + adjCount(s, t, 'grass') * 2;
  if (has(t, 'granary')) f += 5;
  if (has(t, 'dock')) f += 2;
  f += jobWorkers(s, t).farmer * 0.5;
  return f;
}

export function foundTown(s: GameState, owner: Owner, unitId: number): string | null {
  if (s.victory) return 'The war of ideas is over.';
  const u = s.units.find((x) => x.id === unitId);
  if (!u || u.owner !== owner) return 'No such settler.';
  if (u.kind !== 'settler') return 'Only settlers can found towns.';
  const q = u.q, r = u.r;
  const tile = tileAt(s, q, r);
  if (!tile) return 'Out of bounds.';
  if (tile.terrain === 'coast') return 'The sand here is too soft to build on.';
  if (!isSettleable(tile.terrain)) return 'The ground here will not hold a town.';
  if (townAt(s, q, r)) return 'A town already stands here.';
  for (const t of s.towns) {
    if (hexDist(t.q, t.r, q, r) <= 1) return 'Too close to an existing town.';
  }
  if (s.treasury[owner] < CHARTER_COST) return `A charter costs £${CHARTER_COST}. Not enough money.`;
  s.treasury[owner] -= CHARTER_COST;
  s.units = s.units.filter((x) => x.id !== unitId);
  const town: Town = {
    id: s.nextTownId++,
    name: newTownName(s, owner),
    owner,
    q, r,
    pop: 2,
    improvements: [],
    stock: Object.fromEntries(GOODS.map((x) => [x.id, 0])) as Record<GoodId, number>,
    loyalty: 80,
    faith: 0,
    drought: 0,
    foundedYear: s.year,
    fed: true,
    food: 0,
    trainedThisTurn: false,
    shippedThisTurn: false,
    foundedThisTurn: true,
    seasonGross: 0,
    construction: null,
    immuneUntil: 0,
    landBought: [],
  };
  town.food = foodProd(s, town);
  town.fed = town.food >= town.pop * 0.7;
  s.towns.push(town);
  s.log.unshift(`${s.year} — ${town.name} is founded by the ${DEMOS[owner]}.`);
  if (owner === s.player && !s.towns.some((t) => t.owner === s.player && has(t, 'dock'))) {
    s.log.unshift(`${s.year} — No town has a dock yet: nothing can be exported until one is built (£50). Local trade brings in a little the meanwhile.`);
  }
  if (owner === s.player && s.towns.filter((t) => t.owner === s.player).length === 1) {
    hint(s, 'charter', 'Your Charter, Then',
      'A town is a promise: keep the people fed (more meadow, a mill, a granary before winter), build a dock on the water to ' +
      'ship what they make to Europe, and send your remaining settlers inland — the land beyond sight stays dark until someone walks it. ' +
      'The King\u2019s duty rises with the years; by the time the men refuse to pay it, you will have chosen a side. ' +
      'The towns you meet in the woods were here first; trade fairly and they will teach you things.');
  }

  for (const tri of s.tribes) {
    if (!tri.contact[owner] && hexDist(town.q, town.r, tri.q, tri.r) <= tri.claimRadius + 1) {
      tri.contact[owner] = true;
      if (owner !== s.player) continue;
      pushEvent(s, {
        kind: 'contact',
        title: `First Contact — the ${tri.name}`,
        body:
          `A party of ${tri.name} braves, faces painted for ceremony, comes down the trail into plain sight of ${town.name}. ` +
          `The men at the palisade lay down their tools and watch, and the braves stop at the tree line and wait to be met. ` +
          `This is the first meeting between your people and theirs. A meeting, once it happens, carries more than words — ` +
          `and what travels between two camps travels both ways. How you greet them will be spoken of for generations.`,
        data: s.tribes.indexOf(tri),
        choices: [
           { label: 'Send a greeting party with gifts (costs £25)', hint: 'A warm meeting — their standing with you rises' },
           { label: 'Hold your lines and watch', hint: 'A cold meeting — they will remember the distance' },
         ],
       });
    }
  }
  recomputeVisibility(s);
  return null;
}

export function buildImprovement(s: GameState, owner: Owner, townId: number, imp: ImprovementId): string | null {
  const t = s.towns.find((x) => x.id === townId);
  if (!t || t.owner !== owner) return 'No such town of yours.';
  if (isOccupied(s, t.id)) return 'The town is under royal guard — no building is permitted.';
  if (has(t, imp)) return 'Already built.';
  if (t.foundedThisTurn) return 'The settlement is still pitching its tents — building starts next turn.';
  if (t.construction) return `The town is already constructing the ${IMPROVEMENTS[t.construction.imp].name.toLowerCase()}.`;
  const era = improvementEraFor(s, owner, imp);
  if (era > s.era) return `Not yet — the ${IMPROVEMENTS[imp].name.toLowerCase()} waits for ${era === 3 ? 'the Revolutionary Tide' : 'the Age of Trade'}.`;
  if (imp === 'customhouse' && !has(t, 'dock')) return 'The Custom House stands beside the quay — build a dock first.';
  if (imp === 'dock' && !isWaterfront(s, t.q, t.r)) return 'A dock needs water at the town\u2019s edge — the sea or a river. This settlement is upcountry. Build a Wagon Depot to ship out by land.';
  const cost = imp === 'fort' ? fortCost(s, owner) : IMPROVEMENTS[imp].cost;
  if (s.treasury[owner] < cost) return `Not enough money (£${cost} needed).`;
  s.treasury[owner] -= cost;
  t.construction = { imp, turnsLeft: IMPROVEMENTS[imp].turns };
  s.log.unshift(`${s.year} — ${t.name}: work begins on the ${IMPROVEMENTS[imp].name.toLowerCase()} (${IMPROVEMENTS[imp].turns} turn${IMPROVEMENTS[imp].turns > 1 ? 's' : ''}).`);
  return null;
}

export function bombardFrigate(s: GameState, frigateId: number, townId: number): string | null {
  const f = s.units.find((x) => x.id === frigateId);
  if (!f || f.kind !== 'frigate') return 'Only a frigate can bombard.';
  if (f.bombardedThisTurn) return 'That frigate has already loosed its guns this turn.';
  const t = s.towns.find((x) => x.id === townId);
  if (!t) return 'No such town.';
  if (t.owner === f.owner) return 'You do not bombard your own harbours.';
  if (hexDist(f.q, f.r, t.q, t.r) > 2) return 'Out of gun range.';
  f.bombardedThisTurn = true;
  const dmg = has(t, 'fort') ? 1 : 3;
  t.pop = Math.max(1, t.pop - dmg);
  s.log.unshift(
    `${s.year} — The frigate's long guns rake ${t.name}${has(t, 'fort') ? ' against the fort walls' : ''}: ` +
    `${dmg} of the people do not survive the bombardment.`,
  );
  return null;
}

export function giftTribe(s: GameState, tribeIdx: number): string | null {
  const tri = s.tribes[tribeIdx];
  if (!tri) return 'No such nation.';
  const cost = hasFounder(s, s.player, 'franklin') ? 10 : 15;
  if (s.treasury[s.player] < cost) return 'Not enough money.';
  s.treasury[s.player] -= cost;
  tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) + (hasFounder(s, s.player, 'franklin') ? 17 : 12), -100, 100);
  s.log.unshift(`${s.year} — Gifts and words are carried to the ${tri.name}.`);
  return null;
}

export function openTrade(s: GameState, tribeIdx: number): string | null {
  const tri = s.tribes[tribeIdx];
  if (!tri) return 'No such nation.';
  if (tri.trade[s.player]) return 'A trade path already exists.';
  if ((tri.stance[s.player] ?? 0) < -30) return 'The gates are closed to you.';
  const cost = 20;
  if (s.treasury[s.player] < cost) return 'Not enough money.';
  s.treasury[s.player] -= cost;
  tri.trade[s.player] = true;
  tri.stance[s.player] = clamp((tri.stance[s.player] ?? 0) + 10, -100, 100);
  s.log.unshift(`${s.year} — A trade path opens with the ${tri.name}. Trade, like wampum, buys friendship.`);
  return null;
}

function processTown(s: GameState, t: Town): void {
  // Winter is lean: the fields lie fallow and the stores thin.
  const food = foodProd(s, t) * (s.season === 3 ? 0.7 : 1);
  const need = t.pop * 0.7;
  const fed = food >= need;
  t.food = food;
  t.fed = fed;
  if (isOccupied(s, t.id)) {
    t.pop = Math.max(1, t.pop - 1);
    if (t.owner === s.player) t.loyalty = clamp(t.loyalty + 5, 0, 100);
    return;
  }
  if (fed) {
    t.drought = 0;
    const p = 0.4 + (has(t, 'granary') ? 0.25 : 0) + (has(t, 'dock') ? 0.05 : 0) + growthBonusFor(t.owner) + (hasFounder(s, t.owner, 'oglethorpe') ? 0.2 : 0);
    if (chance(s.rng, p)) t.pop++;
  } else {
    t.drought++;
    if (t.drought === 1 && t.owner === s.player) {
      pushEvent(s, {
        kind: 'info',
        title: `The Harvest Falls Short at ${t.name}`,
        body:
          `The fields yield ${food} for a mouthful of ${Math.ceil(need)}. The people eat thin, and a town that cannot ` +
          `feed itself does not work: no goods are produced, and no trade is earned. A granary stores the harvest for ` +
          `lean years; more meadow feeds more mouths.`,
      });
    }
    if (t.drought >= 2) {
      t.pop = Math.max(1, t.pop - famineLossFor(t.owner));
      t.drought = 0;
      if (t.owner === s.player) {
        pushEvent(s, {
          kind: 'winter',
          title: `A Hard Winter at ${t.name}`,
          body: `The stores ran out before the first snow. Two of the people did not see the spring. ` +
            `A granary, or more fields, would keep the tables full.`,
        });
      }
    }
  }
  t.pop = Math.min(t.pop, 60);
  if (!fed) return;
  const tile = tileAt(s, t.q, t.r);
  const grass = (tile?.terrain === 'grass' ? 1 : 0) + adjCount(s, t, 'grass');
  const forest = (tile?.terrain === 'forest' ? 1 : 0) + adjCount(s, t, 'forest');
  let wheat = grass + (has(t, 'mill') ? 3 : 0);
  let lumber = forest + (has(t, 'mill') ? 2 : 0);
  let tobacco = 0;
  let furs = 0;
  let sugar = 0;
  let indigo = 0;
  let silver = 0;
  let iron = 0;
  let spices = 0;
  let cotton = 0;
  const coast = tile?.terrain === 'grass' && isCoastal(s, t.q, t.r);
  if (coast) tobacco = 2 + (has(t, 'tobaccobarn') ? 2 : 0);
  if (tile?.terrain === 'forest') furs = 1;
  if (coast && s.era >= 2) sugar = 1;
  if (tile?.terrain === 'grass' && s.era >= 3) indigo = 1;
  if (tile?.terrain === 'hills') {
    silver = 1;
    iron = 1;
  }
  if (coast) spices = 1;
  if (tile?.terrain === 'grass' && !coast) cotton = 2;
  if (hasSkill(s, t.owner, 'planting') && tile?.terrain === 'grass') wheat += 1;
  if (hasSkill(s, t.owner, 'trapping') && tile?.terrain === 'forest') furs += 1;
  const sig = SIGNATURE_GOOD[t.owner];
  if (sig === 'tobacco') tobacco += 1;
  else if (sig === 'furs') furs += 1;
  else if (sig === 'silver') silver += 1;
  else if (sig === 'iron') iron += 1;
  else if (sig === 'spices') spices += 1;
  if (hasTech(s, t.owner, 'fallow')) wheat += 1;
  if (hasTech(s, t.owner, 'adze')) lumber += 1;
  if (hasTech(s, t.owner, 'refining')) { silver += 1; iron += 1; }
  // Goods are gathered only in their season — the world turns in four.
  const inSeason = (id: GoodId) => GOODS.find((g) => g.id === id)!.seasons.includes(s.season as Season);
  const yieldMap: Record<GoodId, number> = {
    wheat, lumber, tobacco, furs, sugar, indigo, silver, iron, spices,
    cotton, cloth: 0, coats: 0, cigars: 0, rum: 0, tools: 0, muskets: 0, tradeGoods: 0,
  };
  for (const g of GOODS) {
    if (inSeason(g.id) && yieldMap[g.id] > 0) t.stock[g.id] += yieldMap[g.id];
  }
  // Workshops convert raw stock to manufactured wealth, season after season.
  const jobs = jobWorkers(s, t);
  let artisanLeft = jobs.artisan;
  for (const imp of t.improvements) {
    const links = IMPROVEMENTS[imp].manufacture;
    if (!links) continue;
    const bonus = Math.min(1, artisanLeft);
    artisanLeft -= bonus;
    for (const link of links) {
      for (let k = 0; k < link.cap + bonus; k++) {
        if (!link.in.every(([g, n]) => t.stock[g] >= n)) break;
        for (const [g, n] of link.in) t.stock[g] -= n;
        t.stock[link.out] += 1;
      }
    }
  }
  // Storehouses hold so much of a kind; what spills over rots — ship it or lose it.
  for (const g of GOODS) {
    if (t.stock[g.id] > STORAGE_CAP) {
      const spoil = t.stock[g.id] - STORAGE_CAP;
      t.stock[g.id] = STORAGE_CAP;
      if (t.owner === s.player && spoil >= 3) {
        s.log.unshift(`${s.year} — ${spoil} ${g.name.toLowerCase()} spoiled in the overflowing storehouses at ${t.name}.`);
      }
    }
  }
}

/** One-time onboarding hints: said once, never repeated. */
function hint(s: GameState, id: string, title: string, body: string): void {
  const seen = s.tutorial ?? (s.tutorial = []);
  if (seen.includes(id)) return;
  seen.push(id);
  pushEvent(s, { kind: 'info', title, body, choices: [{ label: 'Understood', hint: 'The council disperses to work.' }] });
}

export function sendShip(
  s: GameState,
  townId: number,
  amounts: Partial<Record<GoodId, number>>,
): string | null {
  const t = s.towns.find((x) => x.id === townId);
  if (!t) return 'No such town.';
  if (!has(t, 'dock')) return 'A dock is needed to ship goods.';
  if (isOccupied(s, t.id)) return 'The docks are under royal guard — no shipping.';
  if (t.owner === s.player && s.tradeSevered) return 'The ports stand sealed — you severed trade with the mother country.';
  if (t.shippedThisTurn) return 'The dock is busy loading a ship — one departure per turn.';
  let total = 0;
  let value = 0;
  for (const g of GOODS) {
    const n = Math.floor(amounts[g.id] ?? 0);
    if (n <= 0) continue;
    if (n > t.stock[g.id]) return `Only ${t.stock[g.id]} ${g.name} in store.`;
    total += n;
    value += n * mSell(s, t.owner, g.id);
  }
  if (total === 0) return 'The hold is empty — choose what to load.';
  if (total > SHIP_CARGO_CAP) return `A sloop carries at most ${SHIP_CARGO_CAP} goods.`;
  value = Math.round(value * (1 + exportBonusPct(s, t.owner)) * (1 + 0.05 * jobWorkers(s, t).trader));
  const quota = SALES_CAP + (has(t, 'customhouse') ? SALES_CAP_CUSTOM : 0);
  const sold = t.seasonGross ?? 0;
  if (sold + value > quota) {
    return `The season's sales out of ${t.name} would reach £${sold + value} against Europe's market factor — £${quota} a season${has(t, 'customhouse') ? '' : ' (a Custom House would lift it)'}.`;
  }
  const hostiles = s.units.filter((u) => u.kind === 'frigate' && u.owner !== t.owner && hexDist(u.q, u.r, t.q, t.r) <= 2);
  const escorted = s.units.some((u) => u.kind === 'frigate' && u.owner === t.owner && hexDist(u.q, u.r, t.q, t.r) <= 1);
  if (hostiles.length > 0 && !escorted) {
    for (const g of GOODS) {
      const n = Math.floor(amounts[g.id] ?? 0);
      if (n > 0) t.stock[g.id] -= n;
    }
    const plunderer = hostiles[0].owner;
    const plunder = Math.round(value * 0.5);
    s.treasury[plunderer] += plunder;
    s.log.unshift(
      `${s.year} — The sloop out of ${t.name} is cut off on the open water by a ${DEMOS[plunderer]} frigate. ` +
      `The crew keeps £${plunder} of the cargo; the rest burns.`,
    );
    return null;
  }
  const cargo: Partial<Record<GoodId, number>> = {};
  for (const g of GOODS) {
    const n = Math.floor(amounts[g.id] ?? 0);
    if (n > 0) {
      t.stock[g.id] -= n;
      cargo[g.id] = n;
    }
  }
  let best: GoodId = 'wheat';
  let bestVal = 0;
  for (const g of GOODS) {
    const n = Math.floor(amounts[g.id] ?? 0);
    const v = n * mSell(s, t.owner, g.id);
    if (n > 0 && v > bestVal) {
      bestVal = v;
      best = g.id;
    }
  }
  t.shippedThisTurn = true;
  t.seasonGross = sold + value;
  if (t.owner === s.player) s.exportValue += value;
  s.ships.push({
    id: s.nextShipId++,
    owner: t.owner,
    fromQ: t.q,
    fromR: t.r,
    good: best,
    amount: total,
    t: 0,
    voyage: VOYAGE_TURNS,
    value,
    escort: escorted,
    cargo,
    townName: t.name,
  });
  if (s.ships.length > 12) s.ships.splice(0, s.ships.length - 12);
  if (t.owner === s.player && !s.firstExport) {
    s.firstExport = true;
    pushEvent(s, {
      kind: 'info',
      title: 'The First Consignment',
      body:
        'The first cargo you have loaded leaves for the mother country. A customs man with a ledger steps aboard, ' +
        'weighs the holds, and takes the Crown\u2019s half. The men call it a duty. The men of England call it a tax. ' +
        'Both words will matter, later.',
    });
  }
  s.log.unshift(`${s.year} — A ship leaves ${t.name} for Europe: ${total} goods, £${Math.round(value)} worth.`);
  return null;
}

/** The town's own nearest port (a town of the same owner with a dock). */
export function nearestOwnDock(s: GameState, t: Town): Town | null {
  let best: Town | null = null;
  let bd = Infinity;
  for (const o of s.towns) {
    if (o.owner !== t.owner || !has(o, 'dock')) continue;
    const d = hexDist(o.q, o.r, t.q, t.r);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export const WAGON_TOLL = 0.1;

/** Sell one unit of a good the nation covets, drawn from the owner's nearest stocked town. They pay, and standing rises. */
export function sellToTribe(s: GameState, owner: Owner, tribeIdx: number, good: GoodId): string | null {
  const tri = s.tribes[tribeIdx];
  if (!tri) return 'No such nation.';
  if (!tri.wants.includes(good)) return `The ${tri.name} have no use for ${GOODS.find((g) => g.id === good)?.name.toLowerCase()}.`;
  const name = GOODS.find((g) => g.id === good)?.name.toLowerCase();
  const myTowns = s.towns
    .filter((t) => t.owner === owner && t.stock[good] > 0)
    .sort((a, b) => hexDist(a.q, a.r, tri.q, tri.r) - hexDist(b.q, b.r, tri.q, tri.r));
  const src = myTowns[0];
  if (!src) return `No ${name} to trade — stock some at a town first.`;
  src.stock[good] -= 1;
  const price = Math.round(mSell(s, owner, good) * 0.6);
  s.treasury[owner] += price;
  tri.stance[owner] = clamp((tri.stance[owner] ?? 0) + 3, -100, 100);
  if (owner === s.player) {
    s.log.unshift(`${s.year} — You trade a load of ${name} to the ${tri.name} for £${price}. They value what you make.`);
  }
  return null;
}

/** Buy goods in Europe through a dock town: they ride home on the returning ship, and
 *  the purchase itself thins Europe's stock — driving that market's price back up. */
export function buyFromEurope(s: GameState, townId: number, good: GoodId, n: number): string | null {
  const t = s.towns.find((x) => x.id === townId);
  if (!t) return 'No such town.';
  if (t.owner !== s.player) return 'Not your town.';
  if (!has(t, 'dock')) return 'Only a dock town can trade with Europe.';
  if (isOccupied(s, t.id)) return 'The docks are under royal guard — no trade.';
  if (n <= 0 || n > SHIP_CARGO_CAP) return `A hold takes 1-${SHIP_CARGO_CAP} at a time.`;
  if (n > 0 && s.era < (GOODS.find((g) => g.id === good)?.era ?? 1)) return 'Not yet sold in Europe.';
  const cost = Math.round(n * mBuy(s, s.player, good));
  if (s.treasury[s.player] < cost) return `The goods cost £${cost}. Not enough money.`;
  s.treasury[s.player] -= cost;
  t.stock[good] += n;
  s.supply[s.player][good] = Math.max(s.supply[s.player][good] - n, -GOODS.find((g) => g.id === good)!.market.supply * 0.25);
  s.log.unshift(`${s.year} — ${t.name} buys ${n} ${GOODS.find((g) => g.id === good)?.name.toLowerCase()} in London for £${cost}.`);
  return null;
}

/** Deliver a nation's whole demand list at once: they pay a premium and remember it.
 *  Faithful fulfilment is the road to the skills the originals traded for (docs §5). */
export function fulfillDemand(s: GameState, owner: Owner, tribeIdx: number): string | null {
  const tri = s.tribes[tribeIdx];
  if (!tri) return 'No such nation.';
  if (tri.demand.length === 0) return 'The village seeks nothing just now — return when the season turns.';
  if ((tri.stance[owner] ?? 0) < -55) return `The ${tri.name} will not trade with you.`;
  const myTowns = s.towns.filter((t) => t.owner === owner);
  if (myTowns.length === 0) return 'You have no towns to draw goods from.';
  for (const d of tri.demand) {
    const have = myTowns.reduce((a, t) => a + t.stock[d.good], 0);
    if (have < d.qty) return `You need ${d.qty - have} more ${GOOD_BY_ID[d.good].name.toLowerCase()} in your stores.`;
  }
  let reward = 0;
  for (const d of tri.demand) {
    let left = d.qty;
    for (const t of [...myTowns].sort((a, b) => b.stock[d.good] - a.stock[d.good])) {
      const take = Math.min(left, t.stock[d.good]);
      t.stock[d.good] -= take;
      left -= take;
      if (left === 0) break;
    }
    reward += d.qty * mSell(s, owner, d.good) * 1.5;
  }
  reward = Math.round(reward);
  s.treasury[owner] += reward;
  tri.stance[owner] = clamp((tri.stance[owner] ?? 0) + 10, -100, 100);
  tri.demandsFulfilled++;
  const list = tri.demand.map((d) => `${d.qty} ${GOOD_BY_ID[d.good].name.toLowerCase()}`).join(' and ');
  tri.demand = rollDemand(tri.wants, s.rng);
  tri.demandTurns = 8 + Math.floor(s.rng() * 9);
  if (owner === s.player) {
    s.log.unshift(`${s.year} — The ${tri.name} demand is met: ${list}. They pay £${reward}, hands clasped, words kept.`);
    // Every other fulfilled demand earns a taught skill (deterministic, the originals' bargain).
    const SKILLS: { id: string; name: string; desc: string }[] = [
      { id: 'trapping', name: 'The Trapper\u2019s Arts', desc: 'Winter ways learned from the nations: every forest town takes +1 furs.' },
      { id: 'planting', name: 'The Planting Way', desc: 'Hill wives\u2019 seedcraft: every grass town raises +1 wheat.' },
      { id: 'scouting', name: 'The Snowshoe Pace', desc: 'Woodland marching: your settlers and soldiers go one further each season.' },
    ];
    if (tri.demandsFulfilled % 2 === 1) {
      const mine = s.skills[owner] ?? (s.skills[owner] = []);
      const gift = SKILLS.find((k) => !mine.includes(k.id));
      if (gift) {
        mine.push(gift.id);
        pushEvent(s, { kind: 'info', title: `The ${tri.name} Teach You`, body: `${gift.name}. ${gift.desc}` });
      }
    }
  } else {
    s.log.unshift(`${s.year} — The ${DEMOS[owner]} colony delivers a demand of the ${tri.name}.`);
  }
  return null;
}

/** Buy a township's land outright from the nation whose claim it stands on (docs §5). */
export function buyLand(s: GameState, owner: Owner, townId: number): string | null {
  const t = s.towns.find((x) => x.id === townId);
  if (!t || t.owner !== owner) return 'No such town of yours.';
  const COST = 60;
  if (s.treasury[owner] < COST) return `The deed costs £${COST}. Not enough gold.`;
  const tri = s.tribes.find((tr) => hexDist(tr.q, tr.r, t.q, t.r) <= tr.claimRadius && !t.landBought.includes(owner));
  if (!tri) return t.landBought.length > 0 ? 'This land\u2019s deed is already bought and witnessed.' : 'No nation holds claim on this ground — there is nothing to buy.';
  s.treasury[owner] -= COST;
  t.landBought.push(owner);
  tri.stance[owner] = clamp((tri.stance[owner] ?? 0) + 5, -100, 100);
  if (owner === s.player) s.log.unshift(`${s.year} — A deed of £${COST} is witnessed: ${t.name}\u2019s land is bought from the ${tri.name}. They will not resent what they have sold.`);
  return null;
}

/** Road building (docs §9): a cleared lane between two of your towns. */
export const ROAD_COST = 40;
export const ROAD_TURNS = 3;

/** Tile indices of every finished lane owned by `owner` (for cheap walking). */
export function roadTilesFor(s: GameState, owner: Owner): Set<number> {
  const set = new Set<number>();
  for (const r of s.roads) if (r.owner === owner) for (const t of r.tiles) set.add(t);
  return set;
}

/** Is there a finished lane between these two towns (either end)? */
export const hasRoad = (s: GameState, aId: number, bId: number): boolean =>
  s.roads.some((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));

/** Dijkstra over walkable ground between two towns; returns the tile indices of the lane. */
function roadPathTiles(s: GameState, a: Town, b: Town): number[] {
  const key = (q: number, r: number) => r * s.mapW + q;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const start = key(a.q, a.r);
  dist.set(start, 0);
  const frontier: Array<{ q: number; r: number; cost: number }> = [{ q: a.q, r: a.r, cost: 0 }];
  while (frontier.length > 0) {
    frontier.sort((x, y) => x.cost - y.cost);
    const cur = frontier.shift()!;
    const ck = key(cur.q, cur.r);
    if ((dist.get(ck) ?? Infinity) < cur.cost) continue;
    for (const n of neighbors(cur.q, cur.r)) {
      const tile = tileAt(s, n.q, n.r);
      if (!tile) continue;
      if (!isLand(tile.terrain) && tile.terrain !== 'river') continue;
      const step = terrainMoveCost(tile.terrain);
      if (!isFinite(step)) continue;
      const nk = key(n.q, n.r);
      const nc = cur.cost + step;
      if (nc < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nc);
        prev.set(nk, ck);
        frontier.push({ q: n.q, r: n.r, cost: nc });
      }
    }
  }
  const goal = key(b.q, b.r);
  if (!dist.has(goal)) return [];
  const tiles: number[] = [];
  for (let k: number | undefined = goal; k !== undefined; k = prev.get(k)) tiles.push(k);
  return tiles.reverse();
}

/** Break ground on a lane between two of your towns. */
export function buildRoad(s: GameState, owner: Owner, fromId: number, toId: number): string | null {
  const a = s.towns.find((x) => x.id === fromId);
  const b = s.towns.find((x) => x.id === toId);
  if (!a || !b || a.owner !== owner || b.owner !== owner) return 'Both ends must be towns of yours.';
  if (a.id === b.id) return 'A road needs two different towns.';
  if (isOccupied(s, a.id) || isOccupied(s, b.id)) return 'A town on that line is under royal guard — no work is permitted.';
  if (hasRoad(s, a.id, b.id)) return 'A lane already runs between them.';
  if (s.roadWork.some((w) => (w.from === a.id && w.to === b.id) || (w.from === b.id && w.to === a.id))) return 'Work has already begun on that line.';
  if (s.treasury[owner] < ROAD_COST) return `The road costs £${ROAD_COST}. Not enough money.`;
  s.treasury[owner] -= ROAD_COST;
  s.roadWork.push({ owner, from: a.id, to: b.id, turnsLeft: ROAD_TURNS });
  if (owner === s.player) s.log.unshift(`${s.year} — Work begins on the road from ${a.name} to ${b.name} (${ROAD_TURNS} seasons).`);
  return null;
}

function advanceRoadWorks(s: GameState): void {
  if (s.roadWork.length === 0) return;
  const still: GameState['roadWork'] = [];
  for (const w of s.roadWork) {
    const a = s.towns.find((x) => x.id === w.from);
    const b = s.towns.find((x) => x.id === w.to);
    if (!a || !b || a.owner !== w.owner || b.owner !== w.owner) {
      if (w.owner === s.player) s.log.unshift(`${s.year} — The half-cut road lies abandoned; one of its towns is no longer yours.`);
      continue;
    }
    w.turnsLeft--;
    if (w.turnsLeft > 0) { still.push(w); continue; }
    const tiles = roadPathTiles(s, a, b);
    s.roads.push({ owner: w.owner, a: a.id, b: b.id, tiles });
    if (w.owner === s.player) s.log.unshift(`${s.year} — The road from ${a.name} to ${b.name} is cleared. Carts pass toll-free and your people walk it easy.`);
  }
  s.roadWork = still;
}

/** Haul goods from an inland town to its nearest port, paying a toll. The port ships them onward. */
export function sendWagons(s: GameState, townId: number, amounts: Partial<Record<GoodId, number>>): string | null {
  const t = s.towns.find((x) => x.id === townId);
  if (!t) return 'No such town.';
  if (!has(t, 'wagondepot')) return 'A Wagon Depot is needed to haul goods by land.';
  if (has(t, 'dock')) return 'This town has a dock — ship directly.';
  if (isOccupied(s, t.id)) return 'The depot is under royal guard — no hauling.';
  if (t.owner === s.player && s.tradeSevered) return 'The ports stand sealed — there is nowhere for the wagons to haul to.';
  if (t.shippedThisTurn) return 'The wagon train is already loaded — one convoy per turn.';
  const port = nearestOwnDock(s, t);
  if (!port) return 'You have no port to haul to yet — build a dock somewhere on the coast or a river.';
  let total = 0;
  let value = 0;
  for (const g of GOODS) {
    const n = Math.floor(amounts[g.id] ?? 0);
    if (n <= 0) continue;
    if (n > t.stock[g.id]) return `Only ${t.stock[g.id]} ${g.name} in store.`;
    total += n;
    value += n * mSell(s, t.owner, g.id);
  }
  if (total === 0) return 'The carts are empty — choose what to load.';
  if (total > SHIP_CARGO_CAP) return `A wagon train carries at most ${SHIP_CARGO_CAP} goods.`;
  const lane = hasRoad(s, t.id, port.id);
  const toll = lane ? 0 : Math.max(1, Math.round(value * wagonTollPct(s, t.owner)));
  if (toll > 0) {
    if (s.treasury[t.owner] < toll) return `The wagon toll is £${toll}. Not enough money.`;
    s.treasury[t.owner] -= toll;
  }
  for (const g of GOODS) {
    const n = Math.floor(amounts[g.id] ?? 0);
    if (n > 0) {
      t.stock[g.id] -= n;
      port.stock[g.id] += n;
    }
  }
  t.shippedThisTurn = true;
  s.log.unshift(`${s.year} — A wagon train leaves ${t.name} for ${port.name}: ${total} goods, ${lane ? 'toll-free along your own road' : `a £${toll} toll`}. The port will ship it onward.`);
  return null;
}

export function trainUnit(s: GameState, owner: Owner, townId: number, kind: UnitKind): string | null {
  const t = s.towns.find((x) => x.id === townId);
  if (!t || t.owner !== owner) return 'No such town of yours.';
  if (isOccupied(s, t.id)) return 'The town is under royal guard — no training is permitted.';
  if (t.foundedThisTurn) return 'The men are too busy raising the settlement to train anyone yet.';
  if (unitsOn(s, t.q, t.r).length >= 6) return 'The square is full — the town cannot train another.';
  if (!t.fed) return 'The people are hungry — no one can be spared from the fields.';
  if (t.trainedThisTurn) return 'They have already trained someone this turn.';
  if (kind === 'frigate') {
    if (!has(t, 'dock')) return 'A dock is needed to build a frigate.';
    const water = neighbors(t.q, t.r).some(
      (n) => {
        const tile = tileAt(s, n.q, n.r);
        return tile ? tile.terrain === 'ocean' || tile.terrain === 'coast' : false;
      },
    );
    if (!water) return 'The yard needs open water — no ship can launch from here.';
  }
  if (kind === 'soldier' || kind === 'ranger') {
    if (t.stock.muskets < 1) return 'A soldier carries a musket — none in store. Make them at the armory or buy them in Europe.';
    if (kind === 'ranger' && tileAt(s, t.q, t.r)?.terrain !== 'forest' && adjCount(s, t, 'forest') === 0) {
      return 'Rangers learn the woods — only a town in or beside forest can train one.';
    }
  }
  const cost = kind === 'militia' ? militiaCostFor(owner) : kind === 'frigate' ? frigateCost(s, owner) : TRAIN_COST[kind];
  if (s.treasury[owner] < cost) return `Training costs £${cost}. Not enough money.`;
  s.treasury[owner] -= cost;
  if (kind === 'soldier' || kind === 'ranger') t.stock.muskets--;
  t.trainedThisTurn = true;
  s.units.push({ id: s.nextUnitId++, owner, kind, q: t.q, r: t.r, moveLeft: 0, bombardedThisTurn: false });
  if (owner === s.player) {
    const label: Record<UnitKind, string> = { settler: 'A new settler', militia: 'A new militiaman', soldier: 'A new line soldier', ranger: 'A new ranger', frigate: 'A frigate' };
    s.log.unshift(`${s.year} — ${label[kind]} is ${kind === 'frigate' ? 'launched' : 'trained'} at ${t.name}.`);
  }
  return null;
}

/** Sell price the given owner gets in their Europe market. */
export const mSell = (s: GameState, owner: Owner, g: GoodId): number => s.sellP[owner][g];
/** Buy price the given owner pays in their Europe market (sell + spread). */
export const mBuy = (s: GameState, owner: Owner, g: GoodId): number => s.buyP[owner][g];

/** How thin Europe's own stock of an untouched good can get (the original's scarcity drift:
 *  unsold markets empty out and prices rise ABOVE their initial value). */
const MARKET_FLOOR = 0.75;

/**
 * Europe market update, per owner (docs/original-mechanics.md §2):
 * price = base × initialStock / (initialStock + delivered supply); delivered supply is
 * digested each season and an unworked market slowly runs short (the original's
 * 'attrition'); buying costs the spread over selling; New World goods never rise more
 * than +2 over base; no price moves more than ±1 per season.
 */
function updatePrices(s: GameState): void {
  for (const o of allOwners(s)) {
    for (const g of GOODS) {
      const m = g.market;
      const target = m.supply * (MARKET_FLOOR - 1); // Europe's steady hunger for the good
      const cur = s.supply[o][g.id];
      s.supply[o][g.id] = cur > target ? Math.max(target, cur - Math.max(0.5, cur * m.recover)) : cur;
      const amount = m.supply + s.supply[o][g.id];
      let sell = Math.round(g.base * (m.supply / amount));
      if (m.newWorld) sell = Math.min(sell, g.base + 2);
      sell = Math.max(1, sell);
      // anti-runaway: prices can only travel one mark a season
      sell = clamp(sell, s.sellP[o][g.id] - 1, s.sellP[o][g.id] + 1);
      s.sellP[o][g.id] = sell;
      s.buyP[o][g.id] = sell + m.spread;
    }
  }
  // Mirror the player's market into the UI-facing fields.
  for (const g of GOODS) {
    s.prevPrices[g.id] = s.prices[g.id];
    s.prices[g.id] = s.sellP[s.player][g.id];
  }
}

const ALLIANCE_STANCE = 50;

function processTribe(s: GameState, tri: Tribe): void {
  const owners = allOwners(s);

  // The village's trading list renews with the seasons.
  tri.demandTurns--;
  if (tri.demandTurns <= 0) {
    tri.demand = rollDemand(tri.wants, s.rng);
    tri.demandTurns = 8 + Math.floor(s.rng() * 9);
  }

  // Standing with each empire drifts toward neutral; expansion into a claim deepens the grudge.
  for (const owner of owners) {
    let st = tri.stance[owner] ?? 0;
    st += st > 0 ? -0.5 : 0.5;
    for (const t of s.towns) {
      if (t.owner === owner && !t.landBought.includes(owner) && hexDist(t.q, t.r, tri.q, tri.r) <= tri.claimRadius) st -= 1.5;
    }
    tri.stance[owner] = clamp(st, -100, 100);
  }

  // Trade: each empire with an open path earns what the nation's lands yield.
  for (const owner of owners) {
    if (!tri.trade[owner]) continue;
    const st = tri.stance[owner] ?? 0;
    if (st > -30) {
      for (const g of tri.produces) {
        let units = 1;
        if (g === 'furs') {
          units = tri.id === 'iroquois' ? 2 : 1;
          if (st > 40) units += 1;
          if (tri.alliance === owner) units += 1;
        }
        s.income[owner] += units * mSell(s, owner, g);
      }
    }
  }

  // Alliance: the empire with the highest leading standing may win the nation.
  let top: Owner | null = null;
  let topStance = -Infinity;
  let second = -Infinity;
  for (const o of owners) {
    const st = tri.stance[o] ?? 0;
    if (st > topStance) {
      second = topStance;
      topStance = st;
      top = o;
    } else if (st > second) {
      second = st;
    }
  }

  if (tri.alliance === 'none') {
    if (top && topStance >= ALLIANCE_STANCE && topStance > second) {
      if (top === s.player) {
        if (!tri.allianceOffered) {
          tri.allianceOffered = true;
          const rivals = s.rivals;
          const leadingRival = rivals.length > 0 ? rivals.reduce((a, b) => ((tri.stance[a] ?? 0) >= (tri.stance[b] ?? 0) ? a : b)) : null;
          const rivalName = leadingRival ? EMPIRE_NAMES[leadingRival] : 'the other powers';
          const rivalDemo = leadingRival ? DEMOS[leadingRival] : 'rival';
          pushEvent(s, {
            kind: 'alliance',
            data: s.tribes.indexOf(tri),
            title: `The ${tri.name} Offer Alliance`,
            body:
              `Wampum belts arrive, carried by a delegation that has walked since before the last moon. The ${tri.name} ` +
              `are the greatest power of this land, and they are weighing your name against ${rivalName}'s. Accept, and ` +
              `their warriors stand with yours — and turn on the ${rivalDemo} towns. Decline, and the offer passes; ` +
              `${rivalName} may not decline so gracefully.`,
            choices: [
              { label: 'Accept the alliance', hint: `Their warriors strike at rival towns every ten turns` },
              { label: 'Decline', hint: 'The offer is gone when it is gone' },
            ],
          });
        }
      } else {
        tri.alliance = top;
        pushEvent(s, {
          kind: 'info',
          title: `The ${tri.name} Ally with ${EMPIRE_NAMES[top]}`,
          body:
            `Word comes down the river: the ${tri.name} have bound themselves to ${EMPIRE_NAMES[top]} with wampum and treaty. ` +
            `Expect their war parties to come to your borders in ${DEMOS[top]} company, and come hard.`,
        });
      }
    }
  } else if (tri.alliance === s.player && s.turn % 10 === 0 && tri.pop > 50) {
    const targets = s.towns
      .filter((t) => t.owner !== s.player)
      .sort((a, b) => hexDist(a.q, a.r, tri.q, tri.r) - hexDist(b.q, b.r, tri.q, tri.r));
    const target = targets[0];
    if (target && hexDist(target.q, target.r, tri.q, tri.r) <= tri.claimRadius + 4) {
      const demo = DEMOS[target.owner];
      if (has(target, 'fort') || unitsOn(s, target.q, target.r).some((u) => u.kind === 'militia')) {
        pushEvent(s, {
          kind: 'info',
          title: `The ${tri.name} Turn Back at ${target.name}`,
          body:
            `Allied warriors came against the ${demo} town of ${target.name} and found it manned and walled. ` +
            `They went home with their honour. A fort or a militiaman is worth more than it costs.`,
        });
      } else {
        target.pop = Math.max(1, target.pop - 2);
        pushEvent(s, {
          kind: 'info',
          title: `A Joint Strike on ${target.name}`,
          body:
            `At your word, ${tri.name} warriors fell on the ${demo} town of ${target.name} at first light. ` +
            `Two of the people are gone, and the ${demo} will count the cost of having courted your enemies.`,
        });
      }
    }
  }

  const hostileOwner: Owner | null = tri.alliance !== 'none' && tri.alliance !== s.player ? tri.alliance : null;
  const joint = hostileOwner !== null;
  const raidChance = joint ? 0.45 : 0.3;
  const raidDamage = joint ? 4 : 3;
  if (((tri.stance[s.player] ?? 0) < -55 || joint) && tri.pop > 0 && chance(s.rng, raidChance)) {
    const targets = s.towns
      .filter((t) => t.owner === s.player)
      .sort((a, b) => hexDist(a.q, a.r, tri.q, tri.r) - hexDist(b.q, b.r, tri.q, tri.r));
    const target = targets[0];
    if (target && hexDist(target.q, target.r, tri.q, tri.r) <= 8) {
      if (has(target, 'fort')) {
        pushEvent(s, {
          kind: 'raid',
          title: `The ${tri.name} Test the Fort at ${target.name}`,
          body: `War parties came at dusk and went back empty, the palisade and the cannon answering their arrows. ` +
            `The ${tri.name} will not forget the ground their dead could have walked over.`,
        });
      } else if (unitsOn(s, target.q, target.r).some((u) => u.kind === 'militia')) {
        pushEvent(s, {
          kind: 'raid',
          title: `The Militia Holds ${target.name}`,
          body: `War parties came before dawn and met muskets already loaded. The militiaman stood his ground in the ` +
            `square and the raiders broke off before they could take a single life. The ${tri.name} will remember who defended this soil.`,
        });
      } else {
        target.pop = Math.max(1, target.pop - raidDamage);
        pushEvent(s, {
          kind: 'raid',
          title: joint ? `A Joint Raid on ${target.name}` : `A Raid on ${target.name}`,
          body: joint
            ? `${DEMOS[hostileOwner!]} traders and ${tri.name} war parties came together before dawn, and the town had no wall to answer them. ` +
              `${raidDamage} of the people are gone, the fields burned. ${EMPIRE_NAMES[hostileOwner!]} is paying for this war in your blood — ` +
              `and the ${tri.name} will keep coming while the treaty holds.`
            : `War parties came before dawn and the town had no wall to answer them. ${raidDamage} of the people are gone, ` +
              `the fields are burned, and the ${tri.name} take what they can carry. A fort would stand between your people and the dark.`,
        });
      }
    }
  }
}

const FRA_TOWN_CAP = 5;

function aiEmpire(s: GameState, owner: Owner): void {
  const aiTowns = s.towns.filter((t) => t.owner === owner);

  const loadAmounts = (t: Town): Partial<Record<GoodId, number>> => {
    const amounts: Partial<Record<GoodId, number>> = {};
    let total = 0;
    for (const g of GOODS) {
      const room = SHIP_CARGO_CAP - total;
      if (room <= 0) break;
      const n = Math.min(t.stock[g.id], room);
      if (n > 0) {
        amounts[g.id] = n;
        total += n;
      }
    }
    return total > 0 ? amounts : {};
  };
  for (const t of aiTowns) {
    if (has(t, 'dock')) {
      for (let guard = 0; guard < 3; guard++) {
        const amounts = loadAmounts(t);
        if (Object.keys(amounts).length === 0) break;
        const err = sendShip(s, t.id, amounts);
        if (err) break;
      }
    } else if (has(t, 'wagondepot')) {
      const amounts = loadAmounts(t);
      if (Object.keys(amounts).length > 0) sendWagons(s, t.id, amounts);
    }
  }

  for (const t of aiTowns) {
    const priorities: ImprovementId[] = [];
    if (!t.fed) priorities.push('granary');
    if (isWaterfront(s, t.q, t.r)) priorities.push('dock');
    else if (!has(t, 'dock')) priorities.push('wagondepot');
    if (!priorities.includes('granary')) priorities.push('granary');
    priorities.push('mill');
    // workshops when the raw stock is worth converting
    if (t.stock.furs >= 6 && !has(t, 'tannery') && !t.improvements.includes('tannery')) priorities.push('tannery');
    if (t.stock.cotton >= 4 && !has(t, 'weaver')) priorities.push('weaver');
    if (t.stock.iron >= 4 && !has(t, 'smithy')) priorities.push('smithy');
    if (s.era >= 2 && (t.stock.sugar >= 4 || t.stock.tobacco >= 6) && !has(t, 'refinery')) priorities.push('refinery');
    const threatened = s.tribes.some(
      (tr) => (tr.stance[owner] ?? 0) < -20 && hexDist(t.q, t.r, tr.q, tr.r) <= tr.claimRadius + 2,
    );
    if (threatened) priorities.push('fort');
    for (const imp of priorities) {
      if (!has(t, imp) && s.treasury[owner] >= IMPROVEMENTS[imp].cost + 8) {
        const err = buildImprovement(s, owner, t.id, imp);
        if (!err) break;
      }
    }
    if (!t.trainedThisTurn && t.fed) {
      const hasMilitia = unitsOn(s, t.q, t.r).some((u) => u.kind === 'militia');
      if (threatened && !has(t, 'fort') && !hasMilitia && s.treasury[owner] >= MILITIA_COST + 10) {
        trainUnit(s, owner, t.id, 'militia');
      } else if (aiTowns.length < FRA_TOWN_CAP && s.treasury[owner] >= SETTLER_COST + 30) {
        trainUnit(s, owner, t.id, 'settler');
      }
    }
  }

  if (s.turn % 8 === 0) {
    for (const tri of s.tribes) {
      if (tri.alliance !== 'none') continue;
      if ((tri.stance[owner] ?? 0) < 40 && s.treasury[owner] >= 35) {
        s.treasury[owner] -= 15;
        tri.stance[owner] = clamp((tri.stance[owner] ?? 0) + 12, -100, 100);
      }
      if (!tri.trade[owner] && (tri.stance[owner] ?? 0) >= -30 && s.treasury[owner] >= 20) {
        s.treasury[owner] -= 20;
        tri.trade[owner] = true;
        tri.stance[owner] = clamp((tri.stance[owner] ?? 0) + 10, -100, 100);
      }
    }
  }

  const hasFrigate = s.units.some((u) => u.kind === 'frigate' && u.owner === owner);
  if (!hasFrigate) {
    // Frigates need the open sea — a river dock will refuse the build.
    const dockTown = aiTowns.find((t) => has(t, 'dock') && t.fed && !t.trainedThisTurn && isCoastal(s, t.q, t.r));
    if (dockTown && s.treasury[owner] >= frigateCost(s, owner) + 40) {
      trainUnit(s, owner, dockTown.id, 'frigate');
    }
  }
  for (const f of s.units.filter((u) => u.kind === 'frigate' && u.owner === owner)) {
    const enemyDocks = s.towns.filter((t) => t.owner !== owner && has(t, 'dock'));
    if (enemyDocks.length === 0) continue;
    let target = enemyDocks[0];
    let bd = Infinity;
    for (const t of enemyDocks) {
      const d = hexDist(f.q, f.r, t.q, t.r);
      if (d < bd) {
        bd = d;
        target = t;
      }
    }
    if (bd <= 2 || f.moveLeft <= 0) continue;
    const step = nextStepToward(s, f, target.q, target.r);
    if (step) moveUnit(s, f.id, step.q, step.r);
  }

  const aiUnits = s.units.filter((u) => u.owner === owner && u.kind === 'settler');
  for (const u of aiUnits) {
    const tile = tileAt(s, u.q, u.r);
    const nearTown = s.towns.some((t) => hexDist(t.q, t.r, u.q, u.r) <= 1);
    const goodSpot =
      !!tile &&
      isSettleable(tile.terrain) &&
      !nearTown &&
      tile.terrain === 'grass' &&
      !s.tribes.some((tr) => hexDist(u.q, u.r, tr.q, tr.r) <= tr.claimRadius + 1);
    if (goodSpot && aiTowns.length < FRA_TOWN_CAP && s.treasury[owner] >= CHARTER_COST + 20) {
      foundTown(s, owner, u.id);
      continue;
    }
    const reach = reachableTiles(s, u);
    if (reach.length === 0) continue;
    let best: { q: number; r: number; score: number } | null = null;
    for (const rc of reach) {
      const t2 = tileAt(s, rc.q, rc.r);
      if (!t2 || !isSettleable(t2.terrain)) continue;
      if (s.towns.some((t) => hexDist(t.q, t.r, rc.q, rc.r) <= 2)) continue;
      let score = t2.terrain === 'grass' || t2.terrain === 'coast' ? 2 : 1;
      if (s.tribes.some((tr) => hexDist(rc.q, rc.r, tr.q, tr.r) <= tr.claimRadius + 1)) score -= 8;
      // Keep out of another empire's home corridor — empires colonise their own lands.
      for (const o of allOwners(s)) {
        if (o !== owner && inStartBand(o, rc.q, rc.r)) score -= 6;
      }
      const otherTowns = s.towns.filter((t) => t.owner !== owner);
      const dOther = otherTowns.length > 0 ? Math.min(...otherTowns.map((t) => hexDist(rc.q, rc.r, t.q, t.r))) : hexDist(rc.q, rc.r, s.playerStart.q, s.playerStart.r);
      if (dOther > 5 && dOther < 14) score += 1;
      score += s.rng() * 0.8;
      if (!best || score > best.score) best = { q: rc.q, r: rc.r, score };
    }
    if (best) moveUnit(s, u.id, best.q, best.r);
  }

  // Trade with the nations: sell them what they covet, from a town's surplus.
  if (s.turn % 2 === 0) {
    for (let ti = 0; ti < s.tribes.length; ti++) {
      const tri = s.tribes[ti];
      if (tri.wants.length === 0) continue;
      const near = aiTowns.filter((t) => hexDist(t.q, t.r, tri.q, tri.r) <= tri.claimRadius + 6);
      if (near.length === 0) continue;
      const good = tri.wants.find((g) => near.some((t) => t.stock[g] >= 3));
      if (good) sellToTribe(s, owner, ti, good);
    }
  }

  const mine = s.researched[owner] ?? (s.researched[owner] = []);
  for (const tech of TECHS) {
    if (mine.includes(tech.id)) continue;
    if (s.era < tech.era || (s.insight[owner] ?? 0) < tech.cost) continue;
    s.insight[owner] = (s.insight[owner] ?? 0) - tech.cost;
    mine.push(tech.id);
    break;
  }
  // rival crowns also answer their own notables when insight allows
  const called = s.founders[owner] ?? (s.founders[owner] = []);
  for (const f of FOUNDERS) {
    if (called.includes(f.id)) continue;
    if (s.era < f.era || (s.insight[owner] ?? 0) < f.cost) continue;
    s.insight[owner] = (s.insight[owner] ?? 0) - f.cost;
    called.push(f.id);
    s.log.unshift(`${s.year} — ${f.name} enters the service of ${EMPIRE_NAMES[owner]}.`);
    break;
  }
}

/** Buy back the King's permission to trade: £300 of arrears and a humble letter. */
export function resumeTrade(s: GameState): string | null {
  if (!s.tradeSevered) return null;
  if (s.treasury[s.player] < 300) return 'Resuming trade costs £300. Not enough money.';
  s.treasury[s.player] -= 300;
  s.taxesPaid += 300;
  s.tradeSevered = false;
  s.log.unshift(`${s.year} — £300 in arrears and a humble letter: the ports are open to the mother country again.`);
  pushEvent(s, { kind: 'info', title: 'Trade Resumed', body: 'The King’s collectors return to their ledgers. The trade flows — and so does his share of it back into the regiment budget.' });
  return null;
}

/** The war for independence, wave by wave. The King's expedition scales with the taxes you paid him. */
function warPhase(s: GameState): void {
  if (!s.warActive || s.victory) return;
  s.warTurns++;
  const engTowns = s.towns.filter((t) => t.owner === s.player);
  if (!s.garrison && s.wavesFired < 5) {
    s.refIn--;
    if (s.refIn <= 0 && engTowns.length > 0) {
      let target = engTowns[0];
      let bestScore = Infinity;
      for (const t of engTowns) {
        const score = defenseOf(s, t) + t.pop * 0.1;
        if (score < bestScore) { bestScore = score; target = t; }
      }
      // the crown spends the colony's own taxes on the regiments sent against it
      const strength = Math.min(26, 6 + s.wavesFired * 3 + Math.floor(s.taxesPaid / 120));
      s.wavesFired++;
      s.refIn = 16;
      s.garrison = { targetTownId: target.id, arriveIn: 4, strength };
      pushEvent(s, {
        kind: 'troops',
        title: `The King's Expedition ${s.wavesFired} Sails`,
        body:
          `Out of the haze of the bay some ${strength} redcoats pull for ${target.name}, landed with the Crown's own ` +
          `gold — gold raised, season on season, from the colony's trade. Meet their strength with a fort (10), guns (5) ` +
          `and every musket you can stand behind a palisade. The war is ${s.wavesFired} expedition${s.wavesFired > 1 ? 's' : ''} old, ` +
          `and London's patience is a ledger that can be made to run out.`,
        choices: [{ label: 'Let them come ashore', hint: 'Fort, artillery, militia — or the memory of Bunker Hill' }],
      });
    }
  }
  if (s.warTurns >= 48 && !s.garrison && s.occupations.length === 0) {
    s.warActive = false;
    if (engTowns.length >= 2) {
      s.victory = { kind: 'independence', year: s.year, reason: 'The counted cost of a war across the water outran the Crown’s patience.' };
      pushEvent(s, {
        kind: 'declare',
        title: 'The King Counts the Cost',
        body:
          `In ${s.year}, after four seasons of expeditions that the colonies' own duty money paid for, London's ledger ` +
          `closes against the war. Commissioners, then letters, then peace: the towns keep their paper and their guns.`,
      });
    } else {
      s.victory = { kind: 'expelled', year: s.year, reason: 'the rebellion was strangled with the colony’s own tax money.' };
    }
  }
}

export function payFine(s: GameState, townId: number): string | null {
  const occ = s.occupations.find((o) => o.townId === townId);
  if (!occ) return 'No garrison stands here.';
  if (s.treasury[s.player] < 100) return 'The fine is £100. Not enough money.';
  s.treasury[s.player] -= 100;
  s.occupations = s.occupations.filter((o) => o !== occ);
  s.defiance = Math.max(0, s.defiance - 1);
  const t = s.towns.find((x) => x.id === townId);
  s.log.unshift(`${s.year} — A fine of £100 is paid. The garrison at ${t ? t.name : 'the town'} withdraws, sulking.`);
  return null;
}


export function defenseOf(s: GameState, t: Town): number {
  const guard = unitsOn(s, t.q, t.r)
    .filter((x) => x.owner === t.owner && x.kind !== 'frigate')
    .reduce((a, x) => a + unitStrength(x), 0);
  return (has(t, 'fort') ? fortDefenseFor(t.owner) : 0) + (has(t, 'artillery') ? 5 : 0) + guard
    + (hasFounder(s, t.owner, 'lafayette') ? 2 : 0);
}

/** Overland combat strength of a unit. Settlers are a punch, militia a real fist, a line soldier harder still; every win hardens. */
export function unitStrength(u: Unit): number {
  const v = u.veterans ?? 0;
  if (u.kind === 'settler') return 1;
  if (u.kind === 'militia') return militiaDefenseFor(u.owner) + v;
  if (u.kind === 'soldier') return 5 + v;
  if (u.kind === 'ranger') return 3 + v;
  return 0;
}

function crownRetaliation(s: GameState): void {
  if (s.victory) return;
  const engTowns = s.towns.filter((t) => t.owner === s.player);
  if (engTowns.length === 0) return;

  if (s.defiance >= EMBARGO_DEFIANCE && !s.embargoNoted) {
    s.embargoNoted = true;
    pushEvent(s, {
      kind: 'info',
      title: 'The Crown Boycotts the Colony',
      body:
        `Word of your defiance reaches the counting-houses of London, and they answer in their own way. The Crown's ` +
        `factors refuse to buy at a fair price: every ship that lands now is met with a boycott, and the cargo is taken ` +
        `at half its worth. The duty on what does sell has been raised with it. Make the colony too prosperous to ` +
        `ignore, or grow so independent that their ledger no longer matters.`,
    });
  } else if (s.defiance < EMBARGO_DEFIANCE && s.embargoNoted) {
    s.embargoNoted = false;
    s.log.unshift(`${s.year} — The Crown's boycott eases; the factors will buy at a fairer price again.`);
  }

  if (
    !s.garrison &&
    !s.warActive &&
    s.defiance >= 3 &&
    s.defiance % 2 === 1 &&
    s.defiance > s.garrisonsSent
  ) {
    let target = engTowns[0];
    let bestScore = Infinity;
    for (const t of engTowns) {
      const score = defenseOf(s, t) + t.pop * 0.1;
      if (score < bestScore) {
        bestScore = score;
        target = t;
      }
    }
    s.garrisonsSent = s.defiance;
    s.garrison = { targetTownId: target.id, arriveIn: 6, strength: 8 + s.defiance * 2 };
    pushEvent(s, {
      kind: 'troops',
      title: 'The Crown Sends Troops',
      body:
        `Word reaches the colony from London: a royal regiment of strength ${8 + s.defiance * 2} is to land at ` +
        `${target.name} in six turns — your least defended town. You may pay a fine of £100 and recall them, ` +
        `or ready your fort and militia and make the Crown come to grief on your soil. ` +
        `${s.occupationsTaken > 0 ? `They have already taken ${s.occupationsTaken} of your towns. A third closes the colony.` : ''}`,
      choices: [
        { label: 'Pay £100 and recall the troops', hint: 'Crown anger eases; they never come' },
        { label: 'Face them', hint: 'A fort is worth 10, artillery 5, each militiaman 3, a line soldier 5 — meet or beat their strength' },
      ],
    });
  }

  if (s.garrison) {
    s.garrison.arriveIn--;
    if (s.garrison.arriveIn <= 0) {
      const g = s.garrison;
      s.garrison = null;
      const t = s.towns.find((x) => x.id === g.targetTownId);
      if (t) {
        const defense = defenseOf(s, t);
        if (defense >= g.strength) {
          s.defiance = Math.max(0, s.defiance - 1);
          pushEvent(s, {
            kind: 'info',
            title: `The Garrison Is Repelled at ${t.name}`,
            body:
              `The redcoats landed to find ${has(t, 'fort') ? 'stones, muskets, and men who had been waiting' : 'muskets and men who had been waiting'}. ` +
              `Their strength of ${g.strength} met your defence of ${defense}, and the regiment withdrew to its ships ` +
              `with its honour and a few wounds. The men of the colony will tell this one for a hundred years.`,
            choices: [{ label: 'The regiment withdraws to its ships', hint: 'A victory on your own soil' }],
          });
        } else {
          s.occupations.push({ townId: t.id, turnsLeft: 4 });
          s.occupationsTaken++;
          const n = s.occupationsTaken;
          pushEvent(s, {
            kind: 'info',
            title: `Royal Troops Occupy ${t.name}`,
            body:
              `Your defence of ${defense} broke against their ${g.strength}, and the garrison takes the town. For four turns it will ` +
              `produce nothing, train nothing, build nothing, and ship nothing, and the people will thin under the guard. ` +
              `A fine of £100 buys its early withdrawal. This is the ${n === 1 ? 'first' : n === 2 ? 'second' : 'third'} town the Crown has taken — ` +
              `take a third and the colony is closed.`,
            choices: [{ label: 'The redcoats stand in the streets', hint: 'Pay £100 from the town panel to end it early' }],
          });
          if (n >= 3) {
            s.victory = {
              kind: 'expelled',
              year: s.year,
              reason: 'A third town under royal guard — the colony is closed.',
            };
          }
        }
      }
    }
  }

  for (const occ of [...s.occupations]) {
    occ.turnsLeft--;
    if (occ.turnsLeft <= 0) {
      s.occupations = s.occupations.filter((o) => o !== occ);
      const t = s.towns.find((x) => x.id === occ.townId);
      if (t) s.log.unshift(`${s.year} — The garrison at ${t.name} withdraws. The town breathes again.`);
    }
  }
}

function isOccupied(s: GameState, townId: number): boolean {
  return s.occupations.some((o) => o.townId === townId);
}

function crownBusiness(s: GameState): void {
  const engTowns = s.towns.filter((t) => t.owner === s.player);
  if (engTowns.length === 0) return;
  if (!s.navActPassed && s.year >= NAV_ACT_YEAR) {
    s.navActPassed = true;
    for (const t of engTowns) t.loyalty = clamp(t.loyalty - 10, 0, 100);
    pushEvent(s, {
      kind: 'navact',
      title: 'The Navigation Act',
      body:
        'A sealed letter arrives from Whitehall: henceforth every ship that touches these shores must fly the crown\u2019s flag, ' +
        'and every barrel of tobacco, every board of oak, must be weighed and taxed in London. The men in the fields read it aloud, once, and said nothing after.',
    });
  }
  if (
    s.year >= TAX_START_YEAR &&
    (s.year - TAX_START_YEAR) % TAX_INTERVAL === 0 &&
    s.season === 0 &&
    s.turn > 0
  ) {
    const newRate = Math.min(75, s.taxRate + 10);
    pushEvent(s, {
      kind: 'tax',
      data: newRate,
      title: 'The King Raises the Duty',
      body:
        `A collector from the mother country arrives with a ledger: His Majesty's duty on every sale your colonists make ` +
        `in Europe is to rise from ${s.taxRate}% to ${newRate}%. "The fleet that protects these shores must be maintained," ` +
        `he writes, of a fleet most of the men here have never seen. The towns may accept, buy the rate off with a gift, ` +
        `or answer as Boston did to the Port Bill.`,
      choices: [
        { label: `Accept the ${newRate}% duty`, hint: 'Every pound of it is counted into the King’s regiment budget' },
        { label: `Pay £${30 + s.taxRate} to keep ${s.taxRate}%`, hint: 'A gift for the fleet; the rate stands' },
        { label: 'Refuse, and let the ports stand empty', hint: 'Trade with the mother country is severed — until bought back, or settled by war' },
      ],
    });
  }
}

export const FAITH_TARGET = 75;
export const WEALTH_TARGET = 11000;

export function canDeclare(s: GameState): boolean {
  const engTowns = s.towns.filter((t) => t.owner === s.player);
  return (
    !s.victory && !s.warActive &&
    engTowns.length >= 3 &&
    engTowns.every((t) => t.loyalty <= 40)
  );
}

export function canDeclareFaith(s: GameState): boolean {
  const engTowns = s.towns.filter((t) => t.owner === s.player);
  return !s.victory && !s.warActive && engTowns.filter((t) => t.faith >= FAITH_TARGET).length >= 3;
}

export function canDeclareWealth(s: GameState): boolean {
  return !s.victory && !s.warActive && s.exportValue >= WEALTH_TARGET;
}

export function faithReady(s: GameState): number {
  return s.towns.filter((t) => t.owner === s.player && t.faith >= FAITH_TARGET).length;
}

export function declare(s: GameState, kind: DeclareKind): void {
  const ok =
    kind === 'independence' ? canDeclare(s) : kind === 'faith' ? canDeclareFaith(s) : canDeclareWealth(s);
  if (!ok) return;
  const engTowns = s.towns.filter((t) => t.owner === s.player);
  const years = s.year - START_YEAR;
  if (kind === 'independence') {
    s.warActive = true;
    s.warTurns = 0;
    s.wavesFired = 0;
    s.refIn = 6;
    pushEvent(s, {
      kind: 'declare',
      title: 'The Declaration',
      body:
        `In ${s.year}, ${years} years after the first ships, the towns of the colony sign a single paper. It is not ` +
        `yet a nation — it is a war. The King will spend every duty-pound this colony ever paid him on regiments to ` +
        `come and collect it. Hold two towns and outlast his patience (48 seasons) and the paper becomes a country.`,
    });
  } else if (kind === 'faith') {
    s.victory = {
      kind: 'faith',
      year: s.year,
      reason: 'A city upon a hill, and the hill faces the sea.',
    };
    pushEvent(s, {
      kind: 'declare',
      title: 'The City upon a Hill',
      body:
        `In ${s.year}, the meetings of ${engTowns.length} congregations draw up no paper at all — there is nothing to declare ` +
        `to a king they no longer recognise. The bells ring in every town at once, and the colony turns its face inward: ` +
        `a commonwealth under God, watched from every hill. In the long history, this is the other America, the one that ` +
        `almost was, standing on its own two feet before the guns ever spoke.`,
    });
  } else {
    s.victory = {
      kind: 'wealth',
      year: s.year,
      reason: `£${Math.round(s.exportValue)} sent across the water. The ledger is the argument.`,
    };
    pushEvent(s, {
      kind: 'declare',
      title: 'The Ledger',
      body:
        `In ${s.year}, the merchant houses of London do the math and find it uncomfortable: £${Math.round(s.exportValue)} ` +
        `has left these shores, and half of it belongs to the Crown. The colony is no longer a cost to be administered; ` +
        `it is an engine to be kept. So the men of the colony keep the engine, and the key with it. No paper is signed. ` +
        `The invoices are the declaration.`,
    });
  }
}

export function endTurn(s: GameState): void {
  if (s.victory) return;
  s.turn++;
  s.season = (s.season + 1) % SEASONS_PER_YEAR;
  if (s.season === 0) s.year++;
  const newEra: Era = s.year >= ERA_III_YEAR ? 3 : s.year >= ERA_II_YEAR ? 2 : 1;
  if (newEra > s.era) {
    s.era = newEra;
    pushEvent(s, newEra === 2
      ? {
          kind: 'era',
          title: 'The Age of Trade',
          body:
            `Word arrives from the mother country of a new appetite: sugar, the sweet gold of the warm coast. The same ` +
            `coastal grass that grows tobacco now grows it alongside the cane, and the merchant fleet grows fat on both. ` +
            `Tobacco barns are being raised from shore to shore. (New goods: sugar. New building: tobacco barn.)`,
          choices: [{ label: 'Onward', hint: '' }],
        }
      : {
          kind: 'era',
          title: 'The Revolutionary Tide',
          body:
            `Across the Atlantic, the world is turning. Indigo — the dyers' blue — now pays better than any leaf, ` +
            `cannons are being cast for the ramparts, and in every meetinghouse the men speak more and more openly ` +
            `of a future without kings. Loyalty to the Crown will begin to drift on its own. (New goods: indigo. ` +
            `New building: artillery.)`,
          choices: [{ label: 'Onward', hint: '' }],
        });
  }
  s.income = Object.fromEntries((Object.keys(EMPIRE_NAMES) as Owner[]).map((e) => [e, 0])) as Record<Owner, number>;
  for (const t of s.towns) {
    t.trainedThisTurn = false;
    t.seasonGross = 0;
    t.shippedThisTurn = false;
    t.foundedThisTurn = false;
  }
  for (const u of s.units) u.bombardedThisTurn = false;

  for (const sh of s.ships) {
    sh.voyage--;
    if (sh.voyage <= 0) {
      const embargo = false; // defiance no longer crashes prices; the boycott or the war plays that role
      // Valued at ARRIVAL prices, and the cargo lands in this owner's own Europe market.
      let gross = 0;
      for (const g of GOODS) {
        const n = sh.cargo[g.id] ?? 0;
        if (n <= 0) continue;
        gross += n * mSell(s, sh.owner, g.id);
        s.supply[sh.owner][g.id] += n;
      }
      gross = Math.round(gross * (1 + exportBonusPct(s, sh.owner)));
      let net: number;
      if (sh.escort) {
        net = gross;
      } else {
        net = gross * (1 - effectiveDuty(s, sh.owner));
        if (embargo) net *= 0.5;
      }
      s.income[sh.owner] += net;
      if (sh.owner === s.player && !sh.escort) s.taxesPaid += Math.round(gross * effectiveDuty(s, sh.owner));
      s.log.unshift(
        sh.escort
          ? `${s.year} — Cargo from ${sh.townName} reaches Europe: £${Math.round(net)}, uncut — a frigate shadowed the crossing and the Crown took nothing.`
          : embargo
            ? `${s.year} — Cargo from ${sh.townName} reaches Europe to a boycotting port: the Crown's embargo halves the price, and the duty is steep. £${Math.round(net)}.`
            : `${s.year} — Cargo from ${sh.townName} reaches Europe: £${Math.round(net)} after a ${Math.round(effectiveDuty(s, sh.owner) * 100)}% Crown duty.`,
      );
      if (sh.owner === s.player) {
        hint(s, 'first-sale', 'The Sea Pays',
          'Every market has a bottom: goods dumped on Europe sink their own price, and a town may land only £50 of goods a season ' +
          '(a Custom House lifts it to £200). Manufacture instead of shipping raw — two cotton make a cloth worth far more than two cotton. ' +
          'Mind the Crown\u2019s duty on every arrival, and remember: the price board tells you what Europe is short of. Bring her what she lacks.');
      }
    }
  }
  s.ships = s.ships.filter((sh) => sh.voyage > 0);

  crownRetaliation(s);
  crownBusiness(s);
  warPhase(s);
  for (const t of s.towns) processTown(s, t);
  for (const t of s.towns) {
    if (!t.construction || !t.fed) continue;
    t.construction.turnsLeft--;
    if (t.construction.turnsLeft <= 0) {
      const imp = t.construction.imp;
      t.construction = null;
      t.improvements.push(imp);
      s.log.unshift(`${s.year} — ${t.name}: the ${IMPROVEMENTS[imp].name.toLowerCase()} is complete.`);
    }
  }
  advanceRoadWorks(s);
  for (const u of s.units) u.moveLeft = u.kind === 'frigate' ? FRIGATE_MOVEMENT + (hasTech(s, u.owner, 'charts') ? 2 : 0) : SETTLED_MOVEMENT + (u.kind === 'ranger' ? 1 : 0) + (hasFounder(s, u.owner, 'columbus') ? 1 : 0) + (hasSkill(s, u.owner, 'scouting') ? 1 : 0);
  generateInsight(s);
  for (const r of s.rivals) aiEmpire(s, r);
  updatePrices(s);
  // In the wake of first contact, something follows — not always the fever.
  for (const tri of s.tribes) {
    if (tri.followUpIn == null || !tri.followUp) continue;
    tri.followUpIn--;
    if (tri.followUpIn > 0) continue;
    const kind = tri.followUp;
    const data = s.tribes.indexOf(tri);
    if (kind === 'plague') {
      pushEvent(s, {
        kind: 'plague',
        title: `The Fever`,
        body:
          `In the days after the meeting with the ${tri.name}, a sickness shows itself. Smallpox moves through their ` +
          `camps with a speed no one understands — it was carried in the breath, the clothes, the gifts of the greeting. ` +
          `No one meant harm, but no one could stop it. In the centuries ahead, disease will take nine of every ten of ` +
          `these peoples. What you do in this first winter will be remembered.`,
        data,
        choices: [
          { label: 'Share medicine and knowledge (costs £25)', hint: 'The dead will still be many. The living will remember you.' },
          { label: 'There is nothing you can do', hint: 'The fever runs its full course. The survivors will hold a grudge.' },
        ],
      });
      // What began in their camps can jump to the nearest of your settlements.
      seedOutbreak(s, `g:${data}`, undefined, false);
    } else if (kind === 'caravan') {
      const goods = tri.produces.map((g) => GOODS.find((x) => x.id === g)?.name.toLowerCase()).filter(Boolean).join(', ');
      pushEvent(s, {
        kind: 'caravan',
        title: `A ${tri.name} Caravan`,
        body:
          `Word of the meeting travels, and a ${tri.name} trade caravan comes to your settlement with ${goods}. ` +
          `They have seen what your people make, and they want a standing road between your camps. Accept, and the trade ` +
          `becomes a season-by-season thing — they will sell you what their lands yield, and buy what you carry.`,
        data,
        choices: [
          { label: 'Welcome the trade route', hint: 'Ongoing trade opens; a first bounty of their goods' },
        ],
      });
    } else {
      pushEvent(s, {
        kind: 'council',
        title: `The ${tri.name} Council`,
        body:
          `The ${tri.name} elders gather to speak of the newcomers. They send a runner with a request: a tribute of goods ` +
          `and metal for the coming winter, in return for your people walking their land with favour. It is a test of ` +
          `whether you are a neighbour or a threat.`,
        data,
        choices: [
          { label: 'Send tribute (£30)', hint: 'Your standing rises greatly' },
          { label: 'Decline the request', hint: 'They will remember the coldness' },
        ],
      });
    }
  }
  // Seasonal hunts: each season a nation may follow the game across its home ground.
  if (s.turn > 0 && s.turn % HUNT_INTERVAL === 0) {
    for (const tri of s.tribes) {
      if (!chance(s.rng, 0.6)) continue;
      const cands = s.tiles.filter((t) =>
        isLand(t.terrain) &&
        hexDist(t.q, t.r, tri.homeQ, tri.homeR) >= 3 &&
        hexDist(t.q, t.r, tri.homeQ, tri.homeR) <= 8 &&
        !s.towns.some((town) => hexDist(town.q, town.r, t.q, t.r) <= 2),
      );
      if (cands.length > 0) {
        const pick = cands[Math.floor(s.rng() * cands.length)];
        tri.q = pick.q;
        tri.r = pick.r;
        s.log.unshift(`${s.year} — The ${tri.name} follow the game to new hunting grounds.`);
      }
    }
  }
  for (const tri of s.tribes) processTribe(s, tri);

  // Random disease: the denser the colony, the more the sickness has room to move.
  if (s.towns.length > 0 && chance(s.rng, 0.01 + Math.min(0.02, s.towns.length * 0.004))) {
    const pool = s.towns.filter((t) => s.turn >= t.immuneUntil);
    if (pool.length > 0) {
      const t = pool[Math.floor(s.rng() * pool.length)];
      seedOutbreak(s, `t:${t.id}`, undefined, true);
    }
  }
  processOutbreaks(s);

  // Loyalty and faith shift slowly — a season is a fourth of a year.
  for (const t of s.towns) {
    if (t.owner !== s.player) continue;
    let d = (70 - t.loyalty) * 0.015;
    if (has(t, 'meetinghouse')) {
      d -= hasFounder(s, t.owner, 'paine') ? 1.5 : 1;
      t.faith = Math.min(100, t.faith + 0.7);
    }
    if (s.era >= 3) d -= 0.5;
    if (hasTech(s, s.player, 'press')) d -= 0.5;
    t.loyalty = clamp(t.loyalty + d * 0.25, 0, 100);
  }

  for (const o of allOwners(s)) {
    s.income[o] += s.towns.filter((t) => t.owner === o && t.fed).length * LOCAL_TRADE;
    s.income[o] -= s.towns.filter((t) => t.owner === o && t.pop >= 5).length * 2;
    s.treasury[o] += s.income[o];
  }

  recomputeVisibility(s);
}

export function lastPriceDelta(s: GameState, g: GoodId): number {
  return s.prices[g] - s.prevPrices[g];
}

export function avgLoyalty(s: GameState): number {
  const eng = s.towns.filter((t) => t.owner === s.player);
  if (eng.length === 0) return 100;
  return Math.round(eng.reduce((a, t) => a + t.loyalty, 0) / eng.length);
}

export function dominantGood(s: GameState, t: Town): GoodId {
  let best: GoodId = 'wheat';
  let bestVal = -1;
  for (const g of GOODS) {
    const v = t.stock[g.id] * mSell(s, t.owner, g.id);
    if (v > bestVal) {
      bestVal = v;
      best = g.id;
    }
  }
  return best;
}

export { GOOD_BY_ID, IMPROVEMENTS };
