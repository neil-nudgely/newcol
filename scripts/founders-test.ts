import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, buyFounder, foundTown, buildImprovement, hasFounder, frigateCost, fortCost, trainUnit } from '../src/sim/sim';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; eventChoice(s, e.id, 0); } };

// A: purchase gates.
{
  const s = createGame(1607);
  check('A1 no insight, no founder', buyFounder(s, 'columbus') !== null);
  s.insight[s.player] = 50;
  check('A2 era-gated founder refused in Colonial Times', buyFounder(s, 'paine') !== null);
  check('A3 era-legal founder lands', buyFounder(s, 'columbus') === null);
  check('A4 insight spent', s.insight[s.player] === 40);
  check('A5 cannot be called twice', buyFounder(s, 'columbus') !== null);
  check('A6 hasFounder sees him', hasFounder(s, s.player, 'columbus'));
}

// B: Columbus puts a mile in their stride (settler movement 3 -> 4 at turn change).
{
  const s = createGame(1607);
  s.insight[s.player] = 50;
  buyFounder(s, 'columbus');
  endTurn(s); resolve(s);
  const u = s.units.find((x: any) => x.owner === s.player && x.kind === 'settler')!;
  check(`B1 settler range after Columbus [${u.moveLeft}]`, u.moveLeft === 4);
}

// C: Stuyvesant halves the wagon toll; Montcalm the fort bill; the Naval Agent the frigate.
{
  const s = createGame(1607);
  s.treasury.england = 5000;
  const base = fortCost(s, 'england');
  s.insight[s.player] = 200;
  s.era = 2;
  buyFounder(s, 'montcalm');
  check(`C1 fort 100 -> ${fortCost(s, 'england')}`, fortCost(s, 'england') === base - 25);
  buyFounder(s, 'shipwright');
  check(`C2 frigate 60 -> ${frigateCost(s, 'england')}`, frigateCost(s, 'england') === 45);
}

// D: Paine quickens the Meeting House's quiet work on loyalty.
{
  const mk = (withPaine: boolean) => {
    const s = createGame(1607);
    s.treasury[s.player] = 2000;
    foundTown(s, s.player, s.units.find((x: any) => x.owner === s.player && x.kind === 'settler')!.id);
    const t = s.towns.find((x: any) => x.owner === s.player)!;
    t.improvements.push('meetinghouse');
    t.loyalty = 80;
    if (withPaine) { s.era = 2; s.insight[s.player] = 50; buyFounder(s, 'paine'); }
    for (let i = 0; i < 8; i++) { endTurn(s); resolve(s); }
    return s.towns.find((x: any) => x.owner === s.player)!.loyalty;
  };
  const plain = mk(false);
  const withPaine = mk(true);
  check(`D1 Paine's town is further from the Crown [${plain.toFixed(1)} vs ${withPaine.toFixed(1)}]`, withPaine < plain - 0.5);
}

console.log(`\nFOUNDERS TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
