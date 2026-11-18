const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
};

import { createGame, eventChoice, saveGame, loadGame } from '../src/sim/state';
import {
  endTurn, foundTown, buildImprovement, trainUnit, sendShip, payFine, moveUnit,
  canDeclare, canDeclareFaith, canDeclareWealth, declare, reachableTiles,
} from '../src/sim/sim';
import { tileAt } from '../src/sim/state';
import { hexDist } from '../src/sim/hex';
import { GOODS } from '../src/sim/goods';

function bot(s: any, turns: number) {
  for (let i = 0; i < turns && !s.victory; i++) {
    endTurn(s);
    while (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      const idx = ev.kind === 'tax' ? 1 : ev.kind === 'plague' ? 0 : ev.kind === 'visit' ? 1 : ev.kind === 'troops' ? 1 : 0;
      if (!eventChoice(s, ev.id, idx)) break;
    }
    const eng = s.towns.filter((t: any) => t.owner === 'england');
    for (const t of eng) {
      if (s.occupations.some((o: any) => o.townId === t.id) && s.treasury.england >= 100) payFine(s, t.id);
      if (t.improvements.includes('dock')) {
        const amounts: any = {};
        let total = 0;
        for (const k of (GOODS.filter((g) => g.era <= s.era)).map((g) => g.id)) {
          const room = 12 - total;
          if (room <= 0) break;
          const n = Math.min(t.stock[k], room);
          if (n > 0) { amounts[k] = n; total += n; }
        }
        if (total > 0) { sendShip(s, t.id, amounts); break; }
      }
      const isTarget = s.garrison?.targetTownId === t.id;
      if (!t.construction) {
        if (isTarget && !t.improvements.includes('fort') && s.treasury.england >= 100) buildImprovement(s, 'england', t.id, 'fort');
        else if (!t.improvements.includes('dock') && s.treasury.england >= 50) buildImprovement(s, 'england', t.id, 'dock');
        else if (!t.improvements.includes('meetinghouse') && s.treasury.england >= 60) buildImprovement(s, 'england', t.id, 'meetinghouse');
        else if (!t.improvements.includes('granary') && s.treasury.england >= 30) buildImprovement(s, 'england', t.id, 'granary');
      }
      const mil = isTarget ? s.units.filter((u: any) => u.kind === 'militia' && u.q === t.q && u.r === t.r).length : 99;
      if (t.fed && !t.trainedThisTurn && isTarget && mil < 3 && s.treasury.england >= 25) trainUnit(s, 'england', t.id, 'militia');
      else if (t.fed && !t.trainedThisTurn && eng.length < 6 && s.treasury.england >= 50) trainUnit(s, 'england', t.id, 'settler');
    }
    if (eng.length < 6) {
      for (const u of [...s.units].filter((x: any) => x.owner === 'england' && x.kind === 'settler')) {
        const tile = tileAt(s, u.q, u.r);
        const nearTown = s.towns.some((t: any) => hexDist(t.q, t.r, u.q, u.r) <= 1);
        const inClaim = s.tribes.some((tr: any) => hexDist(u.q, u.r, tr.q, tr.r) <= tr.claimRadius);
        const settleable = !!tile && (tile.terrain === 'grass' || tile.terrain === 'forest');
        if (settleable && !nearTown && (!inClaim || eng.length >= 3)) { foundTown(s, 'england', u.id); continue; }
        const reach = reachableTiles(s, u).map((t: any) => ({ q: t.q, r: t.r, cost: t.cost }));
        if (reach.length === 0) continue;
        let best: any = null, bestScore = -Infinity;
        for (const rc of reach) {
          const t2 = tileAt(s, rc.q, rc.r);
          if (!t2 || (t2.terrain !== 'grass' && t2.terrain !== 'forest' && t2.terrain !== 'coast')) continue;
          let score = t2.terrain === 'grass' || t2.terrain === 'coast' ? 2 : 1;
          if (s.towns.some((t: any) => hexDist(t.q, t.r, rc.q, rc.r) <= 1)) score -= 10;
          if (s.tribes.some((tr: any) => hexDist(rc.q, rc.r, tr.q, tr.r) <= tr.claimRadius)) score -= 6;
          if (score > bestScore) { bestScore = score; best = rc; }
        }
        if (best) moveUnit(s, u.id, best.q, best.r);
      }
    }
    const kind = canDeclare(s) ? 'independence' : canDeclareFaith(s) ? 'faith' : canDeclareWealth(s) ? 'wealth' : null;
    if (kind) declare(s, kind);
  }
}

// --- Test 1: save/load determinism round-trip ---
{
  const a = createGame(1607);
  const ua = a.units.find((u: any) => u.owner === 'england')!;
  foundTown(a, 'england', ua.id);
  bot(a, 15);
  saveGame(a);
  const b = loadGame()!;
  bot(a, 10);
  bot(b, 10);
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  const same = ja === jb;
  console.log(`TEST 1 determinism: ${same ? 'PASS' : 'FAIL'} (year ${a.year} vs ${b.year}, ${ja.length} bytes)`);
  if (!same) {
    const A = a as any, B = b as any;
    for (const k of Object.keys(A)) {
      if (k === 'rng') continue;
      if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) console.log('  diff field:', k);
    }
  }
}

// --- Test 2: full game with bot building meetinghouses — which victory fires, when ---
{
  const s = createGame(1607);
  const u = s.units.find((x: any) => x.owner === 'england')!;
  foundTown(s, 'england', u.id);
  let wealthAt: number | null = null, faithAt: number | null = null, indAt: number | null = null;
  for (let i = 0; i < 130; i++) {
    if (indAt === null && canDeclare(s)) indAt = s.year;
    if (faithAt === null && canDeclareFaith(s)) faithAt = s.year;
    if (wealthAt === null && canDeclareWealth(s)) wealthAt = s.year;
    bot(s, 1);
    if (s.victory) break;
  }
  console.log(`TEST 2 paths: independence first possible ${indAt}, faith ${faithAt}, wealth ${wealthAt} (exports £${Math.round(s.exportValBy[s.player])})`);
  console.log(`  victory: ${JSON.stringify(s.victory)}`);
}

// --- Test 3: faith victory actually declared (3 towns via walking bot, then meetinghouses) ---
{
  const s = createGame(1610);
  const first = s.units.find((x: any) => x.owner === 'england')!;
  foundTown(s, 'england', first.id);
  let guard = 0;
  while (s.towns.filter((t: any) => t.owner === 'england').length < 3 && !s.victory && guard++ < 60) bot(s, 1);
  if (s.victory) console.log(`TEST 3 faith: bot ended the game first: ${JSON.stringify(s.victory)}`);
  else {
    let declared = false;
    for (let i = 0; i < 70 && !declared; i++) {
      endTurn(s);
      while (s.pendingEvents.length > 0) {
        const ev = s.pendingEvents[0];
        const idx = ev.kind === 'tax' ? 0 : ev.kind === 'visit' ? 0 : 0;
        if (!eventChoice(s, ev.id, idx)) break;
      }
      for (const t of s.towns.filter((x: any) => x.owner === 'england' && !x.construction && !x.improvements.includes('meetinghouse'))) {
        buildImprovement(s, 'england', t.id, 'meetinghouse');
      }
      if (canDeclareFaith(s)) { declare(s, 'faith'); declared = true; }
    }
    const faiths = s.towns.filter((t: any) => t.owner === 'england').map((t: any) => `${t.name}:${Math.round(t.faith)}`);
    console.log(`TEST 3 faith: victory=${JSON.stringify(s.victory)} faiths=[${faiths.join(', ')}] year=${s.year}`);
  }
}
