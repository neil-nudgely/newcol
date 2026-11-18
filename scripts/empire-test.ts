import { createGame, eventChoice, isCoastal } from '../src/sim/state';
import { endTurn, foundTown, buildImprovement, trainUnit, sendShip, sendWagons, payFine, bombardFrigate, canDeclare, canDeclareFaith, canDeclareWealth, declare, moveUnit, reachableTiles } from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';
import { GOODS, crownDutyFor, fortCostFor, exportBonusFor, growthBonusFor, militiaCostFor, militiaDefenseFor, famineLossFor, EMPIRE_NAMES, RIVAL_OF } from '../src/sim/goods';
import type { Owner } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

const EMPIRES: Owner[] = ['england', 'france', 'spain', 'netherlands', 'sweden', 'portugal', 'denmark', 'prussia', 'russia'];
for (const emp of EMPIRES) {
  const s = createGame(1607, emp);
  // player & rival
  check(`${EMPIRE_NAMES[emp]}: player set`, s.player === emp);
  check(`${EMPIRE_NAMES[emp]}: one rival by default, correct & distinct`, s.rivals.length === 1 && s.rivals[0] === RIVAL_OF[emp] && s.rivals[0] !== emp);
  // 2 regional tribes
  check(`${EMPIRE_NAMES[emp]}: two tribes`, s.tribes.length === 2);
  // trait checks
  if (emp === 'spain') check('spain: +50 treasury (150)', s.treasury[emp] === 150);
  if (emp === 'netherlands') check('netherlands: 30% duty', crownDutyFor(emp) === 0.3);
  if (emp === 'sweden') check('sweden: £60 fort', fortCostFor(emp) === 60);
  if (emp === 'france') check('france: tribes +15 friendlier', s.tribes.every(t => (t.stance[emp] ?? 0) >= (t.id === 'algonquin' ? 20 : 10)));
  if (emp === 'portugal') check('portugal: +10% export', exportBonusFor(emp) === 0.1);
  if (emp === 'denmark') check('denmark: +growth', growthBonusFor(emp) === 0.1);
  if (emp === 'prussia') check('prussia: £15 militia, defend 4', militiaCostFor(emp) === 15 && militiaDefenseFor(emp) === 4);
  if (emp === 'russia') check('russia: famine -1', famineLossFor(emp) === 1);
  // player has 3 settlers
  check(`${EMPIRE_NAMES[emp]}: 3 player settlers`, s.units.filter(u => u.owner === emp && u.kind === 'settler').length === 3);
  // rival has 3 settlers
  check(`${EMPIRE_NAMES[emp]}: 3 rival settlers`, s.units.filter(u => u.owner === s.rivals[0] && u.kind === 'settler').length === 3);
  console.log(`   tribes: ${s.tribes.map(t => `${t.name}(p${Math.round(t.stance[emp] ?? 0)}/r${Math.round(t.stance[s.rivals[0]] ?? 0)})`).join(', ')}`);
}

// Now bot-play each empire to completion to ensure no runtime errors & a victory is reachable
function bot(s: any, turns: number) {
  for (let i = 0; i < turns && !s.victory; i++) {
    endTurn(s);
    while (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      const idx = ev.kind === 'tax' ? 1 : ev.kind === 'plague' ? 0 : ev.kind === 'visit' ? 1 : ev.kind === 'troops' ? 1 : ev.kind === 'alliance' ? 0 : 0;
      if (!eventChoice(s, ev.id, idx)) break;
    }
    const eng = s.towns.filter((t: any) => t.owner === s.player);
    for (const t of eng) {
      if (s.occupations.some((o: any) => o.townId === t.id) && s.treasury[s.player] >= 100) payFine(s, t.id);
      const amounts: any = {};
      let total = 0;
      for (const g of GOODS.filter((x) => x.era <= s.era)) {
        const room = 12 - total;
        if (room <= 0) break;
        const n = Math.min(t.stock[g.id], room);
        if (n > 0) { amounts[g.id] = n; total += n; }
      }
      if (total > 0) {
        if (t.improvements.includes('dock')) sendShip(s, t.id, amounts);
        else if (t.improvements.includes('wagondepot')) sendWagons(s, t.id, amounts);
      }
      const isTarget = s.garrison?.targetTownId === t.id;
      const coastal = isCoastal(s, t.q, t.r);
      const hasPort = t.improvements.includes('dock') || t.improvements.includes('wagondepot');
      if (!t.construction) {
        if (isTarget && !t.improvements.includes('fort') && s.treasury[s.player] >= fortCostFor(s.player)) buildImprovement(s, s.player, t.id, 'fort');
        else if (!hasPort && s.treasury[s.player] >= 50) buildImprovement(s, s.player, t.id, coastal ? 'dock' : 'wagondepot');
        else if (!t.improvements.includes('granary') && s.treasury[s.player] >= 30) buildImprovement(s, s.player, t.id, 'granary');
      }
      if (t.fed && !t.trainedThisTurn && eng.length < 6 && s.treasury[s.player] >= 50) trainUnit(s, s.player, t.id, 'settler');
    }
    if (eng.length < 6) {
      for (const u of [...s.units].filter((x: any) => x.owner === s.player && x.kind === 'settler')) {
        const tile = s.tiles.find((x: any) => x.q === u.q && x.r === u.r);
        const nearTown = s.towns.some((t: any) => hexDist(t.q, t.r, u.q, u.r) <= 1);
        const inClaim = s.tribes.some((tr: any) => hexDist(u.q, u.r, tr.q, tr.r) <= tr.claimRadius);
        const settleable = tile && (tile.terrain === 'grass' || tile.terrain === 'forest');
        if (settleable && !nearTown && (!inClaim || eng.length >= 3)) { foundTown(s, s.player, u.id); continue; }
        const reach = reachableTiles(s, u).map((rc: any) => ({ q: rc.q, r: rc.r }));
        if (reach.length === 0) continue;
        let best: any = null, bestScore = -Infinity;
        for (const rc of reach) {
          const t2 = s.tiles.find((x: any) => x.q === rc.q && x.r === rc.r);
          if (!t2 || (t2.terrain !== 'grass' && t2.terrain !== 'forest' && t2.terrain !== 'coast')) continue;
          let score = t2.terrain === 'grass' || t2.terrain === 'coast' ? 2 : 1;
          if (s.towns.some((t: any) => hexDist(t.q, t.r, rc.q, rc.r) <= 1)) score -= 10;
          score += hexDist(rc.q, rc.r, s.playerStart.q, s.playerStart.r) * 0.15;
          if (score > bestScore) { bestScore = score; best = rc; }
        }
        if (best) moveUnit(s, u.id, best.q, best.r);
      }
    }
    const kind = canDeclare(s) ? 'independence' : canDeclareFaith(s) ? 'faith' : canDeclareWealth(s) ? 'wealth' : null;
    if (kind) declare(s, kind);
  }
}

for (const emp of EMPIRES) {
  const s = createGame(1607, emp);
  foundTown(s, emp, s.units.find((u: any) => u.owner === emp)!.id);
  bot(s, 400);
  check(`${EMPIRE_NAMES[emp]}: bot reaches a victory by 1707 (got: ${s.victory ? s.victory.year + ' ' + s.victory.kind : 'NONE'})`, !!s.victory);
}

// --- Multi-rival boards: the player can choose how many crowns colonise the land ---
for (const emp of ['england', 'spain', 'denmark'] as Owner[]) {
  for (const rc of [2, 3]) {
    const s = createGame(1607, emp, rc);
    const distinct = new Set([s.player, ...s.rivals]).size === s.rivals.length + 1;
    check(`${EMPIRE_NAMES[emp]} rc${rc}: exactly ${rc} distinct rivals`, s.rivals.length === rc && distinct);
    check(`${EMPIRE_NAMES[emp]} rc${rc}: each rival has 3 settlers`, s.rivals.every(r => s.units.filter(u => u.owner === r && u.kind === 'settler').length === 3));
    // every start is at least 8 hex from the others
    const all = [s.player, ...s.rivals].map(o => s.units.find(u => u.owner === o)!);
    let minSep = Infinity;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) minSep = Math.min(minSep, hexDist(all[i].q, all[i].r, all[j].q, all[j].r));
    check(`${EMPIRE_NAMES[emp]} rc${rc}: starts separated (min ${minSep} >= 8)`, minSep >= 8);
  }
}

// Bot still wins on a full 3-rival board (the crowded case)
for (const emp of ['england', 'france', 'spain', 'portugal', 'denmark'] as Owner[]) {
  const s = createGame(1607, emp, 3);
  foundTown(s, emp, s.units.find((u: any) => u.owner === emp)!.id);
  bot(s, 400);
  check(`${EMPIRE_NAMES[emp]} rc3: bot wins with 3 rivals (got: ${s.victory ? s.victory.year + ' ' + s.victory.kind : 'NONE'})`, !!s.victory);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
