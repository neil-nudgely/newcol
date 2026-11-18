import { createGame, eventChoice, isWaterfront } from '../src/sim/state';
import { endTurn, foundTown, buildImprovement, trainUnit, sendShip, sendWagons, payFine, canDeclare, canDeclareFaith, canDeclareWealth, declare, moveUnit, reachableTiles, WEALTH_TARGET, FAITH_TARGET } from '../src/sim/sim';
import { GOODS } from '../src/sim/goods';
import { hexDist } from '../src/sim/hex';

function run(seed: number, player: string) {
  const s = createGame(seed, player);
  foundTown(s, player, s.units.find((u: any) => u.owner === player)!.id);
  const first: { ind: number | null; faith: number | null; wealth: number | null } = { ind: null, faith: null, wealth: null };
  for (let i = 0; i < 400 && !s.victory; i++) {
    endTurn(s);
    while (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      const idx = ev.kind === 'tax' ? 1 : ev.kind === 'troops' ? 1 : ev.kind === 'alliance' ? 0 : 0;
      if (!eventChoice(s, ev.id, idx)) break;
    }
    if (!first.ind && canDeclare(s)) first.ind = s.year;
    if (!first.faith && canDeclareFaith(s)) first.faith = s.year;
    if (!first.wealth && canDeclareWealth(s)) first.wealth = s.year;
    const eng = s.towns.filter((t: any) => t.owner === s.player);
    for (const t of eng) {
      if (s.occupations.some((o: any) => o.townId === t.id) && s.treasury[s.player] >= 100) payFine(s, t.id);
      const amounts: any = {}; let total = 0;
      for (const g of GOODS.filter((x) => x.era <= s.era)) { const room = 12 - total; if (room <= 0) break; const n = Math.min(t.stock[g.id], room); if (n > 0) { amounts[g.id] = n; total += n; } }
      if (total > 0) { if (t.improvements.includes('dock')) sendShip(s, t.id, amounts); else if (t.improvements.includes('wagondepot')) sendWagons(s, t.id, amounts); }
      if (!t.construction) {
        if (!t.improvements.includes('meetinghouse') && s.treasury[s.player] >= 60) buildImprovement(s, s.player, t.id, 'meetinghouse');
        else if (!t.improvements.includes('dock') && !t.improvements.includes('wagondepot') && s.treasury[s.player] >= 50) buildImprovement(s, s.player, t.id, isWaterfront(s, t.q, t.r) ? 'dock' : 'wagondepot');
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
          if (!t2 || (t2.terrain !== 'grass' && t2.terrain !== 'forest' && t2.terrain !== 'coast' && t2.terrain !== 'river')) continue;
          let score = (t2.terrain === 'grass' || t2.terrain === 'coast') ? 2 : 1;
          if (s.towns.some((t: any) => hexDist(t.q, t.r, rc.q, rc.r) <= 1)) score -= 10;
          score += hexDist(rc.q, rc.r, s.playerStart.q, s.playerStart.r) * 0.15;
          if (score > bestScore) { bestScore = score; best = rc; }
        }
        if (best) moveUnit(s, u.id, best.q, best.r);
      }
    }
    if (canDeclare(s)) { declare(s, 'independence'); break; }
  }
  return { win: s.victory, first, exports: Math.round(s.exportValue) };
}

console.log(`WEALTH_TARGET=${WEALTH_TARGET} FAITH_TARGET=${FAITH_TARGET}`);
for (const seed of [1607, 2024, 777, 4242, 99]) {
  const r = run(seed, 'england');
  console.log(`seed ${seed}: win ${r.win?.kind}@${r.win?.year} | first-achievable: ind=${r.first.ind} faith=${r.first.faith} wealth=${r.first.wealth} | exports £${r.exports}`);
}
