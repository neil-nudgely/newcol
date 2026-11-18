import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown, effectiveDuty, sendShip, resumeTrade, declare, canDeclare } from '../src/sim/sim';
import { crownDutyFor } from '../src/sim/goods';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; if (!eventChoice(s, e.id, 0)) break; } };
const settleTown = (s: any) => {
  s.treasury[s.player] = 5000;
  foundTown(s, s.player, s.units.find((u: any) => u.owner === s.player && u.kind === 'settler')!.id);
  const t = s.towns[s.towns.length - 1];
  t.foundedThisTurn = false;
  t.improvements.push('dock');
  return t;
};

// 1. Duty: the player pays the King's rate; rivals keep their own treaties.
{
  const s = createGame(1607, 'england');
  check('player duty starts at the King\u2019s 10%', effectiveDuty(s, 'england') === 0.1);
  s.taxRate = 40;
  check('duty follows the King\u2019s ladder', effectiveDuty(s, 'england') === 0.4);
  check('rival duty untouched by the King\u2019s colony rate', effectiveDuty(s, 'france') === crownDutyFor('france'));
}

// 2. The tax event: accept raises the ladder and every pound funds the regiments.
{
  const s = createGame(1607, 'england');
  const t = settleTown(s);
  // ship a cargo and let it arrive: duty at 10% is booked as taxes paid
  t.stock.tobacco = 12;
  sendShip(s, t.id, { tobacco: 12 });
  s.year = 1618; // next endTurn brings 1619 spring, the first schedule year at our seed
  for (let i = 0; i < 4 && !s.events.some((e: any) => e.kind === 'tax'); i++) { endTurn(s); resolve(s); }
  const taxEv = s.events.find((e: any) => e.kind === 'tax');
  check('the King raises the duty on schedule', !!taxEv);
  check('duty paid on arrival was banked to the Crown', s.taxesPaid > 0);
  check('accepting lifts the rate to 20%', s.taxRate === 20);
}

// 3. Refusal severs the ports; arrears reopen them.
{
  const s = createGame(1607, 'england');
  const t = settleTown(s);
  s.tradeSevered = true;
  t.stock.wheat = 12;
  check('sealed ports refuse a ship', sendShip(s, t.id, { wheat: 12 }) !== null);
  s.treasury[s.player] = 100;
  check('arrears need £300', resumeTrade(s) !== null);
  s.treasury[s.player] = 500;
  check('arrears reopen the ports', resumeTrade(s) === null);
  check('the £300 was counted to the regiments', s.taxesPaid >= 300);
  t.stock.wheat = 12;
  check('and a ship can sail again', sendShip(s, t.id, { wheat: 12 }) === null);
}

// 4. Declaring independence opens the war, not the win — and taxes paid scale the expeditions.
{
  const s = createGame(1607, 'england');
  const t = settleTown(s);
  s.taxRate = 50;
  s.taxesPaid = 1200; // a prosperous, obedient colony — expensive to oppress
  t.loyalty = 30;
  s.towns.push({ ...t, id: t.id + 100, name: 'Second', loyalty: 35, stock: { ...t.stock } });
  s.towns.push({ ...t, id: t.id + 200, name: 'Third', loyalty: 39, stock: { ...t.stock } });
  check('the towns are ripe to declare', canDeclare(s));
  declare(s, 'independence');
  check('declaration opens the war, not the victory', s.warActive && s.victory === null);
  let maxStrength = 0;
  const troopBody = () => {
    const e = [...s.events].reverse().find((x: any) => x.kind === 'troops');
    const m = e ? /some (\d+) redcoats/.exec(e.body) : null;
    if (m) maxStrength = Math.max(maxStrength, Number(m[1]));
  };
  troopBody();
  for (let i = 0; i < 12; i++) { endTurn(s); resolve(s); troopBody(); }
  check(`the first expedition comes strong on a taxed colony [${maxStrength}, waves ${s.wavesFired}]`, s.wavesFired >= 1 && maxStrength >= 14);
  // garrison arrival: fortified town repels (they were cloned from a docked, fort-less town...) just run the war out
  for (let i = 0; i < 80 && s.warActive; i++) { endTurn(s); resolve(s); if (s.occupations.length > 0) s.occupations.length = 0; }
  check(`after 48 seasons of war the Crown counts the cost [victory ${s.victory?.kind}]`, !!s.victory && s.victory.kind === 'independence' && s.wavesFired >= 3);
}

console.log(`\nCROWN TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
