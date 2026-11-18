import { createGame } from '../src/sim/state';
import { jobSlots, jobWorkers, sendShip } from '../src/sim/sim';
import { endTurn } from '../src/sim/sim';
import { GOODS } from '../src/sim/goods';
import type { GameState, GoodId, ImprovementId } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

function town(s: GameState, q: number, r: number, pop: number, imp: ImprovementId[] = [], stock: Partial<Record<GoodId, number>> = {}) {
  const st: Record<GoodId, number> = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;
  Object.assign(st, stock);
  s.towns.push({ id: 800 + s.towns.length, name: 'Workton', owner: 'england', q, r, pop, improvements: imp, stock: st, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, seasonGross: 0, landBought: [] });
  return s.towns[s.towns.length - 1];
}
function ring(s: GameState, q: number, r: number, terrain: 'grass' | 'forest') {
  for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
    const idx = (r + dr) * s.mapW + (q + dq);
    if (s.tiles[idx]) s.tiles[idx].terrain = terrain;
  }
}

// A: slots come from ground and buildings.
{
  const s = createGame(1607);
  ring(s, 20, 10, 'grass');
  const t = town(s, 20, 10, 12, ['weaver', 'dock']);
  const slots = jobSlots(s, t);
  check(`A1 grass gives 4 farmer slots [${slots.farmer}]`, slots.farmer === 4);
  check(`A2 each workshop gives an artisan slot [${slots.artisan}]`, slots.artisan === 1);
  check(`A3 a dock gives two trader slots [${slots.trader}]`, slots.trader === 2);
  const w = jobWorkers(s, t);
  check(`A4 pop fills farmers first, then artisans, then traders [${w.farmer}/${w.artisan}/${w.trader}]`, w.farmer === 4 && w.artisan === 1 && w.trader === 2);
  const small = town(s, 30, 10, 2, ['weaver', 'dock']);
  ring(s, 30, 10, 'grass');
  const w2 = jobWorkers(s, small);
  check(`A5 two souls mean two farmers and no artisan [${w2.farmer}/${w2.artisan}/${w2.trader}]`, w2.farmer === 2 && w2.artisan === 0 && w2.trader === 0);
}

// B: an artisan widens the loom.
{
  const s = createGame(1607);
  ring(s, 20, 10, 'grass');
  const t = town(s, 20, 10, 6, ['weaver', 'tannery'], { cotton: 10, furs: 0 });
  s.season = 2; // the coming endTurn is Winter: raw harvests stay quiet, and no winter furs here
  endTurn(s);
  // 4 farmers + 1 artisan + 1 trader of 6 pop: the one artisan mans the weaver's extra shuttle (cap 3), the tannery gets none
  check(`B1 the artisan's extra shuttle [cloth ${t.stock.cloth}, cotton ${t.stock.cotton}]`, t.stock.cloth === 3 && t.stock.cotton === 4);
}

// C: traders sweeten every shipload.
{
  const s = createGame(1607);
  ring(s, 20, 10, 'forest'); // no farmer slots: the crew go straight to trade
  const t = town(s, 20, 10, 2, ['dock'], { tobacco: 4 });
  s.season = 1; // coming endTurn is Summer: no tobacco harvest to muddy it
  const before = s.exportValue;
  check('C1 the sloop sails', sendShip(s, t.id, { tobacco: 4 }) === null);
  const gained = s.exportValue - before;
  const plain = 4 * s.sellP.england.tobacco;
  check(`C2 two traders add a tenth [${gained} vs ${plain}]`, gained === Math.round(plain * 1.1));
}

console.log(`SPECIALISTS TEST: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
