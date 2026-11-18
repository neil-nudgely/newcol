import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown, giftTribe } from '../src/sim/sim';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; if (!eventChoice(s, e.id, 0)) break; } };

// Prove JOINT STRIKE: allied Iroquois, moved next to a French town, must strike it on the 10-turn cadence
{
  const s = createGame(1607);
  // let France found a town
  for (let i = 0; i < 10; i++) { endTurn(s); resolve(s); }
  let fra = s.towns.find((t: any) => t.owner === 'france');
  if (!fra) { for (let i = 0; i < 20 && !fra; i++) { endTurn(s); resolve(s); fra = s.towns.find((t: any) => t.owner === 'france'); } }
  const iro = s.tribes.find((t: any) => t.id === 'iroquois')!;
  iro.alliance = 'england';
  iro.homeQ = fra!.q; iro.homeR = fra!.r; // anchor hunting migrations on the target town
  iro.q = fra!.q; iro.r = fra!.r; // camp on the French town (in range)
  fra!.improvements = fra!.improvements.filter((x: string) => x !== 'fort'); // undefended
  s.units = s.units.filter((u: any) => !(u.q === fra!.q && u.r === fra!.r)); // clear defenders
  const before = fra!.pop;
  let struck = false, logHit = '';
  for (let i = 0; i < 20 && !struck; i++) {
    endTurn(s);
    for (const l of s.log) if (l.includes('Joint Strike') || l.includes('Turn Back')) logHit = l;
    resolve(s);
    if (fra!.pop < before) struck = true;
  }
  check(`JOINT STRIKE fired on French town`, /A Joint Strike on/.test(logHit));
  console.log('   ', logHit || '(no joint-strike log)');
}

// Prove JOINT RAID: France-allied Iroquois, moved next to an English town, must raid at 45%
{
  const s = createGame(1610);
  foundTown(s, 'england', s.units.find((u: any) => u.owner === 'england')!.id);
  const eng = s.towns.find((t: any) => t.owner === 'england')!;
  const iro = s.tribes.find((t: any) => t.id === 'iroquois')!;
  iro.alliance = 'france';
  iro.homeQ = eng.q; iro.homeR = eng.r; // anchor hunting migrations on the target town
  iro.q = eng.q; iro.r = eng.r;
  eng.improvements = eng.improvements.filter((x: string) => x !== 'fort');
  const before = eng.pop;
  let raided = false, logHit = '';
  for (let i = 0; i < 40 && !raided; i++) {
    endTurn(s);
    for (const l of s.log) if (l.includes('Joint Raid')) logHit = l;
    resolve(s);
    if (eng.pop < before) raided = true;
  }
  check(`JOINT RAID fired on English town`, /A Joint Raid on/.test(logHit));
  console.log('   ', logHit || '(no joint-raid log)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
