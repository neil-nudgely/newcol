import { createGame, eventChoice, tileAt } from '../src/sim/state';
import {
  endTurn, foundTown, buildImprovement, canDeclare, canDeclareFaith, canDeclareWealth,
  declare, avgLoyalty,
  moveUnit, reachableTiles, trainUnit, sendShip, payFine,
} from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';
import { GOODS } from '../src/sim/goods';

const seed = Number(process.argv[2] ?? 1607);
const s = createGame(seed);
const fra = s.units.find((u) => u.owner === s.rivals[0])!;
console.log(`map ${s.mapW}x${s.mapH} eng@${s.playerStart.q},${s.playerStart.r} ${s.rivals[0]}@${fra.q},${fra.r} rivals=[${s.rivals}]`);
console.log('tribes:', s.tribes.map((t) => `${t.name}@${t.q},${t.r} pop=${t.pop} claim=${t.claimRadius}`).join(' '));

const landCounts: Record<string, number> = {};
for (const t of s.tiles) landCounts[t.terrain] = (landCounts[t.terrain] ?? 0) + 1;
console.log('terrain:', JSON.stringify(landCounts));

const firstUnit = s.units.find((u) => u.owner === 'england')!;
console.log('found:', foundTown(s, 'england', firstUnit.id));

let founded = 0;
// 4 seasons per year: a full game to independence runs ~180–220 turns.
for (let i = 0; i < 400 && !s.victory; i++) {
  endTurn(s);

  while (s.pendingEvents.length > 0) {
    const ev = s.pendingEvents[0];
    const idx = ev.kind === 'tax' ? 1 : ev.kind === 'plague' ? 0 : ev.kind === 'visit' ? 1 : ev.kind === 'troops' ? 1 : 0;
    const ok = eventChoice(s, ev.id, idx);
    if (!ok) break;
  }

  const eng = s.towns.filter((t) => t.owner === 'england');
  for (const t of eng) {
    if (t.improvements.includes('dock')) {
      const amounts: Record<string, number> = {};
      let total = 0;
      for (const g of GOODS.filter((x) => x.era <= s.era)) {
        const room = 12 - total;
        if (room <= 0) break;
        const n = Math.min(t.stock[g.id], room);
        if (n > 0) {
          amounts[g.id] = n;
          total += n;
        }
      }
      if (total > 0) sendShip(s, t.id, amounts);
    }
    if (s.occupations.some((o) => o.townId === t.id) && s.treasury.england >= 100) {
      payFine(s, t.id);
    }
      const isTarget = s.garrison?.targetTownId === t.id;
      if (t.improvements.includes('dock') && !s.units.some((u) => u.owner === 'england' && u.kind === 'frigate')
        && !t.construction && s.treasury.england >= 20 + 60) {
        trainUnit(s, 'england', t.id, 'frigate');
      }
      if (!t.construction) {
      if (isTarget && !t.improvements.includes('fort') && s.treasury.england >= 100) {
        buildImprovement(s, 'england', t.id, 'fort');
      } else if (!t.improvements.includes('dock') && s.treasury.england >= 50) {
        buildImprovement(s, 'england', t.id, 'dock');
      } else if (!t.improvements.includes('granary') && s.treasury.england >= 30) {
        buildImprovement(s, 'england', t.id, 'granary');
      } else if (!t.improvements.includes('mill') && s.treasury.england >= 40) {
        buildImprovement(s, 'england', t.id, 'mill');
      }
      const threat = s.tribes.some((tr) => tr.stanceEng < -30 && hexDist(t.q, t.r, tr.q, tr.r) <= tr.claimRadius + 2);
      if (threat && !t.improvements.includes('fort') && s.treasury.england >= 80) {
        buildImprovement(s, 'england', t.id, 'fort');
      }
    }
    const militiaHere = isTarget
      ? s.units.filter((u) => u.kind === 'militia' && u.q === t.q && u.r === t.r).length
      : 99;
    if (t.fed && !t.trainedThisTurn && isTarget && militiaHere < 3 && s.treasury.england >= 25) {
      trainUnit(s, 'england', t.id, 'militia');
    } else if (t.fed && !t.trainedThisTurn && eng.length < 6 && s.treasury.england >= 20 + 30) {
      trainUnit(s, 'england', t.id, 'settler');
    }
  }

  if (eng.length < 6 && s.treasury.england >= 15) {
    for (const u of [...s.units].filter((x) => x.owner === 'england')) {
      const tile = tileAt(s, u.q, u.r);
      const nearTown = s.towns.some((t) => hexDist(t.q, t.r, u.q, u.r) <= 1);
      const inClaim = s.tribes.some((tr) => hexDist(u.q, u.r, tr.q, tr.r) <= tr.claimRadius);
      const settleable = !!tile && (tile.terrain === 'grass' || tile.terrain === 'forest');
      if (settleable && !nearTown && (!inClaim || eng.length >= 3)) {
        const err = foundTown(s, 'england', u.id);
        if (!err) founded++;
        continue;
      }
      const reach = reachableTiles(s, u);
      if (reach.length === 0) continue;
      let best: { q: number; r: number } | null = null;
      let bestScore = -Infinity;
      for (const rc of reach) {
        const t2 = tileAt(s, rc.q, rc.r);
        if (!t2 || (t2.terrain !== 'grass' && t2.terrain !== 'forest' && t2.terrain !== 'coast')) continue;
        let score = t2.terrain === 'grass' || t2.terrain === 'coast' ? 2 : 1;
        if (s.towns.some((t) => hexDist(t.q, t.r, rc.q, rc.r) <= 1)) score -= 10;
        if (s.tribes.some((tr) => hexDist(rc.q, rc.r, tr.q, tr.r) <= tr.claimRadius)) score -= 6;
        score += s.rng() * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = rc;
        }
      }
      if (best) moveUnit(s, u.id, best.q, best.r);
    }
  }

  if (i % 10 === 9) {
    const prices = Object.entries(s.prices).map(([k, v]) => `${k}:${v}`).join(' ');
    const engUnits = s.units.filter((u) => u.owner === 'england').length;
    console.log(
      `y=${s.year} eng=${s.towns.filter((t) => t.owner === 'england').length} fra=${s.towns.filter((t) => t.owner === 'france').length} ` +
      `£=${Math.round(s.treasury.england)} inc=${Math.round(s.income.england)} units=${engUnits} ` +
      `loy=${avgLoyalty(s)} canDeclare=${canDeclare(s)} tribes=${s.tribes.map((t) => `${t.name}:${Math.round(t.stanceEng)}/${t.pop}`).join(' ')} [${prices}]`,
    );
  }
  {
    const kind = canDeclare(s) ? 'independence' : canDeclareFaith(s) ? 'faith' : canDeclareWealth(s) ? 'wealth' : null;
    if (kind) declare(s, kind);
  }
}

console.log('---');
console.log('final year:', s.year, 'victory:', JSON.stringify(s.victory));
console.log('england towns:', s.towns.filter((t) => t.owner === 'england').map((t) => `${t.name} pop=${t.pop} imp=${t.improvements.length}`).join(' | '));
console.log('france towns:', s.towns.filter((t) => t.owner === 'france').map((t) => `${t.name} pop=${t.pop} imp=${t.improvements.length}`).join(' | '));
console.log('treasury:', JSON.stringify({ eng: Math.round(s.treasury.england), fra: Math.round(s.treasury.france) }));
console.log('ships ever:', s.ships.length, 'log tail:', s.log.slice(0, 4).join(' // '));
