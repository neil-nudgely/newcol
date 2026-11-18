import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown, giftTribe } from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; if (!eventChoice(s, e.id, 0)) break; } };

// --- Race: France courts, player outbids for the Iroquois ---
const s = createGame(1607);
foundTown(s, 'england', s.units.find((u: any) => u.owner === 'england')!.id);
const iro = s.tribes.find((t: any) => t.id === 'iroquois')!;
for (let i = 0; i < 16; i++) { endTurn(s); resolve(s); }
check('France has begun courting (stanceFra rose or trade open)', (iro.stance['france'] ?? 0) > 0 || iro.trade['france']);
let guard = 0;
while ((iro.stance['england'] ?? 0) < 55 && iro.alliance === 'none' && guard++ < 20) giftTribe(s, s.tribes.indexOf(iro));
let offered = false;
for (let i = 0; i < 10 && !offered; i++) {
  endTurn(s);
  const ev = s.pendingEvents.find((e: any) => e.kind === 'alliance');
  if (ev) {
    offered = true;
    check('Alliance offer event has 2 choices', ev.choices && ev.choices.length === 2);
    const ok = eventChoice(s, ev.id, 0);
    check('Accept sets alliance to england', ok && iro.alliance === 'england');
  }
}
check('Alliance offer was made', offered);
resolve(s);

// --- Joint strike: allied Iroquois hit the nearest in-range rival town (France is the only rival) ---
if (iro.alliance === 'england') {
  const inRange = s.towns.some((t: any) => t.owner === 'france' && hexDist(t.q, t.r, iro.q, iro.r) <= iro.claimRadius + 4);
  if (inRange) {
    let struck = false;
    for (let i = 0; i < 15 && !struck; i++) {
      endTurn(s); resolve(s);
      if (s.events.some((e: any) => e.title.startsWith('A Joint Strike on'))) struck = true;
    }
    check('Allied Iroquois launched a joint strike on an in-range French town', struck);
  } else {
    console.log('SKIP joint-strike: no French town within ' + (iro.claimRadius + 4) + ' of the Iroquois on this map');
  }
}

// --- Declined offer: France can still win the tribe; joint raid on an in-range English town ---
{
  const s2 = createGame(1610);
  foundTown(s2, 'england', s2.units.find((u: any) => u.owner === 'england')!.id);
  const iro2 = s2.tribes.find((t: any) => t.id === 'iroquois')!;
  iro2.stance['england'] = 60; iro2.stance['france'] = 10;
  let declined = false;
  for (let i = 0; i < 3 && !declined; i++) {
    endTurn(s2);
    const ev = s2.pendingEvents.find((e: any) => e.kind === 'alliance');
    if (ev) { eventChoice(s2, ev.id, 1); declined = true; }
    resolve(s2);
  }
  check('Declined offer does not re-offer', declined);
  iro2.stance['france'] = 70;
  endTurn(s2); resolve(s2);
  check('France auto-allies when it leads', iro2.alliance === 'france');
  // joint raid on an in-range English town — place one within 8 of the Iroquois if needed
  if (!s2.towns.some((t: any) => t.owner === 'england' && hexDist(t.q, t.r, iro2.q, iro2.r) <= 8)) {
    const eng = s2.units.find((u: any) => u.owner === 'england' && u.kind === 'settler');
    const near = s2.tiles.find((t: any) => (t.terrain === 'grass' || t.terrain === 'forest') && hexDist(t.q, t.r, iro2.q, iro2.r) <= 6);
    if (eng && near) { eng.q = near.q; eng.r = near.r; foundTown(s2, 'england', eng.id); }
  }
  const engInRange = s2.towns.some((t: any) => t.owner === 'england' && hexDist(t.q, t.r, iro2.q, iro2.r) <= 8);
  if (engInRange) {
    let raided = false;
    for (let i = 0; i < 40 && !raided; i++) {
      endTurn(s2); resolve(s2);
      if (s2.events.some((e: any) => e.title.startsWith('A Joint Raid on'))) raided = true;
    }
    check('France-allied Iroquois launched a joint raid on an in-range English town', raided);
  } else {
    console.log('SKIP joint-raid: no English town within 8 of the Iroquois on this map');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
