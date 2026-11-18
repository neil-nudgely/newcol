import { createGame, eventChoice } from '../src/sim/state';
import { endTurn } from '../src/sim/sim';
import { GOODS, STORAGE_CAP } from '../src/sim/goods';
import type { GameState, GoodId, Owner } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: GameState) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; eventChoice(s, e.id, 0); } };

function makeTown(seed: number, owner: Owner, stock: Partial<Record<GoodId, number>>) {
  const s = createGame(seed);
  const st: Record<GoodId, number> = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;
  Object.assign(st, stock);
  s.towns.push({ id: 500, name: 'Stowmark', owner, q: 20, r: 10, pop: 2, improvements: [], stock: st, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, landBought: [] });
  s.season = 1; // the coming endTurn is Winter: no wheat or lumber to muddy the sums
  return s;
}

check('STORAGE_CAP is 30', STORAGE_CAP === 30);

// A: surplus rots, and the colony is told.
{
  const s = makeTown(1607, 'england', { wheat: 40 });
  endTurn(s); resolve(s);
  const t = s.towns[0];
  check(`A1 wheat clamped to the cap [${t.stock.wheat}]`, t.stock.wheat === STORAGE_CAP);
  check('A2 the loss is spoken of', s.log.some((l) => l.includes('spoiled') && l.includes('wheat')));
}

// B: manufactured stock caps too.
{
  const s = makeTown(1607, 'england', { tools: 35 });
  endTurn(s); resolve(s);
  check(`B1 tools clamped [${s.towns[0].stock.tools}]`, s.towns[0].stock.tools === STORAGE_CAP);
}

// C: a trickle over the cap rots quietly.
{
  const s = makeTown(1607, 'england', { lumber: 31 });
  endTurn(s); resolve(s);
  check(`C1 lumber clamped [${s.towns[0].stock.lumber}]`, s.towns[0].stock.lumber === STORAGE_CAP);
  check('C2 small spoilage passes unmentioned', !s.log.some((l) => l.includes('spoiled')));
}

// D: the cap binds rival colonies too, without cluttering your log.
{
  const s = makeTown(1607, 'france', { iron: 40 });
  endTurn(s); resolve(s);
  check(`D1 rival iron clamped [${s.towns[0].stock.iron}]`, s.towns[0].stock.iron === STORAGE_CAP);
  check('D2 no French rot in your log', !s.log.some((l) => l.includes('spoiled')));
}

console.log(`STORAGE TEST: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
