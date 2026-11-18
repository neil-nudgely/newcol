import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown, buildImprovement, trainUnit, moveUnit } from '../src/sim/sim';
import { rec, encodeCode, replayGame } from '../src/replay';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

// Scripted playthrough, recorded exactly the way main.ts records player actions.
const s = createGame(1607, 'england', 1);
const settle = s.units.find((u) => u.owner === 'england')!;
check('founding works', foundTown(s, s.player, settle.id) === null);
rec(s, 'found', [settle.id]);
const town = s.towns[0];
const dockErr = buildImprovement(s, s.player, town.id, 'dock');
if (!dockErr) rec(s, 'build', [town.id, 'dock']);
const militiaErr = trainUnit(s, s.player, town.id, 'militia');
if (!militiaErr) rec(s, 'train', [town.id, 'militia']);
// walk the second settler somewhere reachable
const walker = s.units.find((u) => u.owner === 'england' && u.kind === 'settler')!;
const mv = moveUnit(s, walker.id, walker.q + 1, walker.r);
if (!mv) rec(s, 'move', [walker.id, walker.q, walker.r]);
for (let i = 0; i < 4; i++) {
  rec(s, 'endTurn');
  endTurn(s);
  while (s.pendingEvents.length > 0) {
    const idx = s.pendingEvents[0].kind === 'tax' ? 0 : 0;
    const ok = eventChoice(s, s.pendingEvents[0].id, idx);
    rec(s, 'choice', [idx]);
    if (!ok) break;
  }
}
check('the log recorded actions', (s.actionLog?.length ?? 0) >= 6);

// Encode, decode, replay — the colony must be identical.
const code = encodeCode(s);
check('a colony code is a string of sane size', typeof code === 'string' && code.length > 20 && code.length < 50000);
const r = replayGame(code);
check('the code decodes', r !== null);
if (r) {
  const strip = (g: typeof s) => JSON.stringify(g, (k, v) => (k === 'actionLog' || k === 'rng' ? undefined : v));
  check('replay lands on the same turn and year', r.turn === s.turn && r.year === s.year);
  check('replay reproduces the treasury', JSON.stringify(r.treasury) === JSON.stringify(s.treasury));
  check('replay reproduces every town byte for byte', strip(r) === strip(s));
  // and the future stays forked from the same rng
  endTurn(r);
  endTurn(s);
  check('one season on, the forked games still match', strip(r) === strip(s));
  check('a corrupt code is refused', replayGame('not-a-code') === null);
}

console.log(`REPLAY TEST: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
