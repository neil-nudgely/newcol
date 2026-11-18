import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, buildImprovement, buyFromEurope, mSell } from '../src/sim/sim';
import { GOODS } from '../src/sim/goods';
import type { GameState, GoodId, ImprovementId } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: GameState) => { while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; eventChoice(s, e.id, 0); } };

function makeTown(seed: number, q: number, r: number, owner: 'england' | 'france', imp: ImprovementId[], stock: Partial<Record<GoodId, number>> = {}) {
  const s = createGame(seed);
  const st: Record<GoodId, number> = Object.fromEntries(GOODS.map((g) => [g.id, 0])) as Record<GoodId, number>;
  Object.assign(st, stock);
  s.towns.push({ id: 500, name: 'Fabrickton', owner, q, r, pop: 2, improvements: imp, stock: st, loyalty: 80, drought: 0, faith: 0, foundedYear: 1607, fed: true, food: 10, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, construction: null, immuneUntil: 0, landBought: [] });
  s.season = 0; // the coming endTurn is Summer — no raw harvests to muddy the sums
  for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
    const idx = (r + dr) * s.mapW + (q + dq);
    if (s.tiles[idx]) s.tiles[idx].terrain = 'grass'; // meadow: the two souls farm, they do not artisan
  }
  return s;
}

// A: workshops convert stock every season (and the smithy->armory chain works).
{
  const s = makeTown(1607, 20, 10, 'england', ['weaver', 'smithy'], { cotton: 10, iron: 6 });
  endTurn(s); resolve(s);
  const t = s.towns[0];
  check(`A1 weaver: 2 cloth from 4 cotton [cloth ${t.stock.cloth}]`, t.stock.cloth === 2 && t.stock.cotton === 6);
  check(`A2 smithy: 2 tools from 4 iron, cap per season [tools ${t.stock.tools}]`, t.stock.tools === 2 && t.stock.iron === 2);
  s.era = 2;
  t.improvements.push('armory');
  t.stock.tools = 5;
  t.stock.iron = 0; // clear the smithy's leftovers so the chain sums cleanly
  endTurn(s); resolve(s); // Autumn: +2 cotton, weaver takes 4
  check(`A3 armory chains tools into muskets [muskets ${t.stock.muskets}]`, t.stock.muskets === 2 && t.stock.tools === 1);
  check('A4 loom kept running (cloth total 4)', t.stock.cloth === 4);
}

// B: a hungry town does not manufacture.
{
  const s = makeTown(1607, 20, 10, 'england', ['weaver'], { cotton: 10 });
  const t = s.towns[0];
  t.pop = 60; t.food = 0; t.fed = true; // forced hungry: processTown recomputes fed from foodProd
  endTurn(s); resolve(s);
  check('B1 starving town idles the loom', t.stock.cloth === 0);
}

// C: buying in Europe — dock, money, and the market reacts (buying thins stock, price rises).
{
  const s = makeTown(1607, 20, 10, 'england', ['weaver'], {});
  const t = s.towns[0];
  check('C1 inland town cannot buy', buyFromEurope(s, t.id, 'tradeGoods', 5) !== null);
  t.improvements.push('dock');
  s.treasury.england = 500;
  const before = mSell(s, s.player, 'tradeGoods');
  const paid = s.treasury.england;
  check('C2 dock town can buy', buyFromEurope(s, t.id, 'tradeGoods', 5) === null);
  check('C3 goods landed and money left', t.stock.tradeGoods === 5 && s.treasury.england < paid);
  check('C4 the purchase drew Europe down', s.supply.england.tradeGoods === -5);
  endTurn(s); resolve(s);
  check(`C5 and next season the price rose [${before} -> ${mSell(s, s.player, 'tradeGoods')}]`, mSell(s, s.player, 'tradeGoods') >= before);
  check('C6 era-gated import refused early', buyFromEurope(s, t.id, 'muskets', 1) !== null || s.era >= 2);
}

// D: era gate on building a workshop; nations covet the workshop goods.
{
  const s = makeTown(1607, 20, 10, 'england', [], {});
  s.treasury.england = 1000;
  const t = s.towns[0];
  const err = buildImprovement(s, 'england', t.id, 'refinery');
  check('D1 refinery waits for the Age of Trade', err !== null && /Age of Trade/.test(err));
  const toolLover = s.tribes.find((tr) => !tr.produces.includes('tools') && !tr.produces.includes('iron'));
  check('D2 a nation without forges wants tools', !!toolLover && toolLover.wants.includes('tools'));
}

console.log(`\nMANUFACTURE TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
