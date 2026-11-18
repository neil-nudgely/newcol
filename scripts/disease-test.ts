import { GOODS } from '../src/sim/goods';
import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, seedOutbreak, foundTown } from '../src/sim/sim';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; if (!eventChoice(s, e.id, 0)) break; } };

// A: an outbreak seeded in one nation reaches a neighbouring nation the turn AFTER it starts.
{
  const s = createGame(1607);
  const a = s.tribes[0], b = s.tribes[1];
  b.q = a.q; b.r = a.r;
  const aBefore = a.pop, bBefore = b.pop;
  seedOutbreak(s, 'g:0', 'Smallpox', true);
  check('A1 source nation takes the toll', a.pop < aBefore);
  endTurn(s); resolve(s);
  check('A2 no spread on the season it starts (no double-hit)', b.pop === bBefore);
  endTurn(s); resolve(s);
  check('A3 outbreak spread to the neighbouring nation next season', b.pop < bBefore);
  check('A4 outbreak still active', s.outbreaks.length === 1);
}

// D: survivors are immune — a fresh outbreak passes the immune nation by and takes the town.
{
  const s = createGame(1607);
  const a = s.tribes[0], b = s.tribes[1];
  b.q = a.q; b.r = a.r;
  b.immuneUntil = s.turn + 99; // b already survived the fever
  const stock: any = {};
  for (const g of GOODS) stock[g.id] = 0;
  s.towns.push({ id: 999, name: 'Testmouth', owner: 'france', q: a.q + 1, r: a.r, pop: 40, improvements: [], stock, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, landBought: [] });
  const bBefore = b.pop;
  seedOutbreak(s, 'g:0', 'Measles', false); // start in a's camps without touching them
  endTurn(s); resolve(s); // seeding turn: no spread
  endTurn(s); resolve(s); // it travels: must skip immune b and land on the town
  check('D1 immune nation is passed over', b.pop === bBefore);
  const town = s.towns.find((x: any) => x.id === 999)!;
  check('D2 the fever moves on to the susceptible town', town.pop < 35); // 40 -> ~30 even after a growth tick
}

// B: an outbreak with nowhere to go dies out on its own after its duration.
{
  const s = createGame(1607);
  const a = s.tribes[0];
  for (let i = 1; i < s.tribes.length; i++) { s.tribes[i].q = a.q; s.tribes[i].r = a.r + 30; }
  for (const t of s.towns) { t.q = a.q; t.r = a.r + 30; }
  seedOutbreak(s, 'g:0', 'Measles', true);
  check('B1 seeded one outbreak', s.outbreaks.length === 1);
  for (let i = 0; i < 8; i++) { endTurn(s); resolve(s); }
  check('B2 outbreak ran its course', s.outbreaks.length === 0);
}

// C: a player town raises a quarantine choice; quarantining halves the toll, not doing so takes the full toll.
function playerTownAtPop(pop: number, treasury: number) {
  const s = createGame(1607);
  s.treasury[s.player] = 200;
  const u = s.units.find((x: any) => x.owner === s.player)!;
  foundTown(s, s.player, u.id);
  const t = s.towns.find((x: any) => x.owner === s.player)!;
  t.pop = pop;
  s.treasury[s.player] = treasury;
  return { s, t };
}
{
  const { s, t } = playerTownAtPop(20, 200);
  seedOutbreak(s, `t:${t.id}`, 'Typhus', true);
  const ev = s.pendingEvents.find((e: any) => e.kind === 'outbreak');
  check('C1 player town raises a quarantine event', !!ev);
  eventChoice(s, ev!.id, 0); // quarantine (affordable)
  check('C2 quarantine halves the toll (pop >= 18)', t.pop >= 18);
}
{
  const { s, t } = playerTownAtPop(20, 0);
  seedOutbreak(s, `t:${t.id}`, 'Typhus', true);
  const ev = s.pendingEvents.find((e: any) => e.kind === 'outbreak');
  eventChoice(s, ev!.id, 1); // do nothing
  check('C3 full toll without quarantine (pop <= 15)', t.pop <= 15);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
