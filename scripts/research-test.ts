import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown, buildImprovement, buyTech, hasTech, improvementEraFor } from '../src/sim/sim';
import { TECHS } from '../src/sim/techs';
import type { GameState, Town } from '../src/sim/types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

function autoPlay(s: GameState): boolean {
  const ev = s.pendingEvents[0];
  const i = ev.kind === 'tax' ? 1 : ev.kind === 'plague' ? 0 : ev.kind === 'visit' ? 1 : ev.kind === 'troops' ? 1 : 0;
  return eventChoice(s, ev.id, i) !== false;
}

// Create a game and found the starting town so there is a fed player town to test against.
function mk(techs: string[] = []): { s: GameState; t: Town } {
  const s = createGame(1607, 'england');
  foundTown(s, 'england', 1);
  s.researched['england'] = techs;
  const t = s.towns.find((x) => x.owner === 'england')!;
  return { s, t };
}

function run(g: GameState, turns: number) {
  for (let i = 0; i < turns; i++) {
    endTurn(g);
    while (g.pendingEvents.length) if (!autoPlay(g)) break;
  }
}

// 1. Insight generation
{
  const { s, t } = mk();
  t.improvements.push('meetinghouse', 'mill');
  const before = s.insight['england'];
  run(s, 1);
  const eng = s.towns.filter((x) => x.owner === 'england');
  let expected = 0;
  for (const x of eng) if (x.fed) {
    expected += 1;
    if (x.improvements.includes('meetinghouse')) expected += 1;
    if (x.improvements.includes('mill')) expected += 1;
  }
  check(`insight: fed town + meetinghouse + mill each yield insight (got ${s.insight['england'] - before}, want >= ${expected})`,
    s.insight['england'] - before >= expected && expected >= 3);
}

// 2. buyTech mechanics
{
  const { s } = mk();
  s.insight['england'] = 100;
  const err = buyTech(s, 'fallow');
  check('buyTech: deducts cost and records', err === null && s.insight['england'] === 92 && s.researched['england'].includes('fallow') && hasTech(s, 'england', 'fallow'));
  check('buyTech: cannot buy twice', buyTech(s, 'fallow') !== null);
  const s2 = mk().s; s2.insight['england'] = 3;
  check('buyTech: needs enough insight', buyTech(s2, 'fallow') !== null);
  const s3 = mk().s; s3.insight['england'] = 100;
  check('buyTech: era-locked tech refused in era 1', buyTech(s3, 'press') !== null);
}

// 3. Production effects (same-seed delta)
{
  const a = mk([]); const b = mk(['fallow', 'adze', 'refining']);
  run(a.s, 3); run(b.s, 3);
  const sum = (g: GameState) => { const t = g.towns.find((x) => x.owner === 'england')!; return t.stock.wheat + t.stock.lumber + t.stock.silver + t.stock.iron; };
  check(`research: fallow+adze+refining raise production (${sum(b.s)} > ${sum(a.s)} + 4)`, sum(b.s) >= sum(a.s) + 4);
}

// 4. Fine Gunpowder pulls artillery to era 2
{
  const { s, t } = mk();
  check('artillery: era 3 by default', improvementEraFor(s, 'england', 'artillery') === 3);
  s.researched['england'] = ['powder'];
  check('artillery: era 2 with Fine Gunpowder', improvementEraFor(s, 'england', 'artillery') === 2);
  t.foundedThisTurn = false;
  s.era = 1; s.treasury.england = 1000;
  check('artillery: refused in era 1 even with powder', buildImprovement(s, 'england', t.id, 'artillery') !== null);
  s.era = 2;
  check('artillery: buildable in era 2 with powder', buildImprovement(s, 'england', t.id, 'artillery') === null);
}

// 5. Frigate movement with charts
{
  const mkFrig = (techs: string[]) => {
    const { s, t } = mk(techs);
    s.units.push({ id: 900, owner: 'england', kind: 'frigate', q: t.q, r: t.r, moveLeft: 0, bombardedThisTurn: false });
    run(s, 1);
    return s.units.find((u) => u.kind === 'frigate')!.moveLeft;
  };
  check(`charts: frigate gets 6 movement (got ${mkFrig(['charts'])})`, mkFrig(['charts']) === 6);
  check(`no charts: frigate gets 4 movement (got ${mkFrig([])})`, mkFrig([]) === 4);
}

// 6. Rival auto-research
{
  const { s } = mk();
  const rival = s.rivals[0];
  s.insight[rival] = 50;
  s.era = 2;
  run(s, 3);
  check('rival: auto-researches when it can afford', (s.researched[rival] ?? []).length >= 1);
  const bought = TECHS.find((x) => (s.researched[rival] ?? []).includes(x.id));
  check('rival: only buys era-legal techs', bought !== undefined && bought.era <= 2);
}

// 7. Press loyalty effect (same-seed delta)
{
  const a = mk([]); const b = mk(['press']);
  a.t.loyalty = 60; b.t.loyalty = 60;
  run(a.s, 1); run(b.s, 1);
  const la = a.s.towns.find((x) => x.owner === 'england')!.loyalty;
  const lb = b.s.towns.find((x) => x.owner === 'england')!.loyalty;
  check(`press: loyalty lower with the Printing Press (${lb.toFixed(2)} < ${la.toFixed(2)})`, lb < la);
}

console.log(`\nRESEARCH TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
