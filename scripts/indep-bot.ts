// The independence-path sweep: plays the revolution the way a determined patriot would —
// three towns, meetinghouses, the Declaration when the colonies are ripe, then survive
// the King's expeditions for the full 48 seasons. Sweeps seeds and reports the race.
import { createGame, eventChoice } from '../src/sim/state';
import {
  endTurn, foundTown, buildImprovement, trainUnit, sendShip, canDeclare, declare, avgLoyalty,
  payFine, buyFromEurope, moveUnit, reachableTiles,
} from '../src/sim/sim';
import { GOODS } from '../src/sim/goods';
import { tileAt } from '../src/sim/state';
import { hexDist } from '../src/sim/hex';
import type { GameState } from '../src/sim/types';

function play(seed: number, verbose = false): { kind: string; year: number | string; loyalty: number } {
  const s = createGame(seed);

  const march = (u: (typeof s.units)[number]) => {
    const spots = reachableTiles(s, u).filter((x) => {
      const tile = tileAt(s, x.q, x.r);
      return tile && (tile.terrain === 'grass' || tile.terrain === 'forest');
    });
    if (spots.length === 0) return;
    spots.sort((a, b) => Math.max(...s.towns.map((t) => hexDist(b.q, b.r, t.q, t.r))) - Math.max(...s.towns.map((t) => hexDist(a.q, a.r, t.q, t.r))));
    moveUnit(s, u.id, spots[0].q, spots[0].r);
  };
  const settleFirst = () => {
    for (const u of s.units.filter((x) => x.owner === s.player && x.kind === 'settler')) {
      if (!foundTown(s, s.player, u.id)) march(u);
      else continue;
      foundTown(s, s.player, u.id);
    }
  };
  settleFirst();

  for (let i = 0; i < 400 && !s.victory; i++) {
    endTurn(s);
    while (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      // accept the duty (it cools loyalty), quarantines get money, troops get faced
      const idx = ev.kind === 'tax' ? 0 : 0;
      if (!eventChoice(s, ev.id, idx)) break;
    }

    const eng = s.towns.filter((t) => t.owner === s.player);

    for (const t of eng) {
      const target = s.garrison?.targetTownId === t.id;
      if (s.occupations.some((o) => o.townId === t.id) && s.treasury[s.player] >= 80) payFine(s, t.id);
      // guns before walls, when a regiment is already sailing
      if (target && !t.improvements.includes('artillery') && s.era >= 3 && !t.construction && s.treasury[s.player] > 200) {
        buildImprovement(s, s.player, t.id, 'artillery');
      } else if (target && !t.improvements.includes('fort') && !t.construction && s.treasury[s.player] > 140) {
        buildImprovement(s, s.player, t.id, 'fort');
      } else if (!t.improvements.includes('meetinghouse') && !t.construction && t.fed && s.treasury[s.player] > 60) {
        buildImprovement(s, s.player, t.id, 'meetinghouse');
      } else if (!t.improvements.includes('dock') && !t.construction && s.treasury[s.player] > 90) {
        const dockErr = buildImprovement(s, s.player, t.id, 'dock');
        if (dockErr && !t.improvements.includes('wagondepot') && !t.construction) buildImprovement(s, s.player, t.id, 'wagondepot');
      } else if (!t.improvements.includes('granary') && !t.construction && s.treasury[s.player] > 120 && t.pop > 8) {
        buildImprovement(s, s.player, t.id, 'granary');
      } else if (t.improvements.includes('dock') && s.era >= 2 && !t.improvements.includes('customhouse') && !t.construction && s.treasury[s.player] > 220) {
        buildImprovement(s, s.player, t.id, 'customhouse');
      }
      // a frigate rides shotgun: without one the rival's navy takes half the cargo
      if (t.improvements.includes('dock') && !s.units.some((u) => u.owner === s.player && u.kind === 'frigate') && !t.construction && s.treasury[s.player] > 120) {
        trainUnit(s, s.player, t.id, 'frigate');
      }
      // ship the surplus — the season's quota is a real budget; load to it, not past it
      if (t.improvements.includes('dock') && !s.tradeSevered) {
        const amounts: Record<string, number> = {};
        let total = 0;
        let roomQuota = 100 + (t.improvements.includes('customhouse') ? 100 : 0) - (t.seasonGross ?? 0) - 6;
        for (const g of [...GOODS].reverse()) {
          if (g.id === 'muskets' || g.id === 'tradeGoods' || g.id === 'tools') continue;
          const price = s.sellP[s.player][g.id] || 1;
          const room = Math.min(12 - total, Math.max(0, Math.floor(roomQuota / price)));
          if (room <= 0) continue;
          const n = Math.min(t.stock[g.id], room);
          if (n > 0) { amounts[g.id] = n; total += n; roomQuota -= n * price; }
        }
        if (total > 0) {
          const serr = sendShip(s, t.id, amounts as never);
          if (verbose && serr) console.log(`    SEND ERR y${s.year}: ${serr}`);
        }
      }
      // arms for the revolution: muskets from Europe or the armory feed soldiers
      if (t.stock.muskets > 0 && !t.trainedThisTurn && t.fed && s.treasury[s.player] > 60 && (target || s.warActive)) {
        trainUnit(s, s.player, t.id, 'soldier');
      }
    }

    // buy muskets through the dock towns while at war
    if (s.warActive && s.turn % 4 === 0) {
      for (const t of eng) {
        if (t.improvements.includes('dock') && s.treasury[s.player] > 160) buyFromEurope(s, t.id, 'muskets', 5);
      }
    }

    if (eng.length < 4 && s.treasury[s.player] > 130 && !s.warActive) {
      const trainer = eng.find((t) => !t.construction && !t.trainedThisTurn && t.fed && s.units.filter((x) => x.owner === s.player && x.kind === 'settler').length < 2);
      if (trainer) trainUnit(s, s.player, trainer.id, 'settler');
      for (const idle of s.units.filter((u) => u.owner === s.player && u.kind === 'settler' && u.moveLeft > 0)) {
        if (foundTown(s, s.player, idle.id)) march(idle);
      }
    }

    if (canDeclare(s)) declare(s, 'independence');
    if (verbose && i % 24 === 0) {
      console.log(`  t${i} y${s.year} imps=${eng.map((t) => t.improvements.join('+') || '-').join('|')} cons=${eng.map((t) => t.construction?.imp ?? '-').join(',')} fed=${eng.map((t) => t.fed).join(',')} ships=${s.ships.length} towns=${eng.length} can=${canDeclare(s)} loy=${eng.map((t) => Math.round(t.loyalty)).join(',')} war=${s.warActive} exp=${Math.round(s.exportValBy[s.player])} tr=${Math.round(s.treasury[s.player])} settlers=${s.units.filter((u) => u.owner === s.player && u.kind === 'settler').length} mh=${eng.filter((t) => t.improvements.includes('meetinghouse')).length}`);
    }
  }

  return {
    kind: s.victory?.kind ?? (avgLoyalty(s) <= 40 && s.towns.filter((t) => t.owner === s.player).length >= 3 ? 'ripe-but-late' : 'stalled'),
    year: s.victory?.year ?? s.year,
    loyalty: Math.round(avgLoyalty(s)),
  };
}

const seeds = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const list = seeds.length ? seeds : [1, 2, 3, 5, 7, 11, 13, 1607, 2024, 12345];
const rows = [];
for (const seed of list) {
  const r = play(seed, list.length === 1);
  rows.push(r);
  console.log(`seed ${String(seed).padEnd(6)} ${String(r.kind).padEnd(14)} ${String(r.year).padEnd(5)} loyalty ${r.loyalty}`);
}
const byKind: Record<string, number> = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log(`\nkinds: ${JSON.stringify(byKind)}`);
