import { createGame, eventChoice, tribeGoodsFor } from '../src/sim/state';
import { endTurn, foundTown, openTrade, sellToTribe } from '../src/sim/sim';
import { MAP_W, MAP_H } from '../src/sim/state';
import type { Tile, GoodId } from '../src/sim/types';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const ALL: GoodId[] = ['tobacco', 'wheat', 'lumber', 'furs', 'sugar', 'indigo', 'silver', 'iron', 'spices'];

// 1. tribeGoodsFor: terrain drives produces & wants
{
  const make = (center: string, ring: string): Tile[] => {
    const tiles: Tile[] = [];
    for (let r = 0; r < MAP_H; r++) for (let q = 0; q < MAP_W; q++) tiles.push({ q, r, terrain: (q === 10 && r === 10 ? center : ring) as any, elev: 0.5 });
    return tiles;
  };
  const grassCoast = make('grass', 'coast');
  const g1 = tribeGoodsFor(10, 10, grassCoast);
  check('coastal grassland nation grows tobacco & spices', g1.produces.includes('tobacco') && g1.produces.includes('spices'));
  check('grassland nation grows wheat', g1.produces.includes('wheat'));
  check('wants excludes what it produces', g1.wants.every((g) => !g1.produces.includes(g)));

  const hills = make('hills', 'grass');
  const g2 = tribeGoodsFor(10, 10, hills);
  check('hills nation mines iron & silver', g2.produces.includes('iron') && g2.produces.includes('silver'));

  const forest = make('forest', 'forest');
  const g3 = tribeGoodsFor(10, 10, forest);
  check('forest nation yields furs & lumber', g3.produces.includes('furs') && g3.produces.includes('lumber'));
}

// 2. Real game: every tribe has produces & wants; wants exclude produces
{
  const s = createGame(1607, 'england', 3);
  check('all tribes have goods', s.tribes.every((t: any) => t.produces.length > 0 && t.wants.length > 0));
  check('wants never include produces', s.tribes.every((t: any) => t.wants.every((g: GoodId) => !t.produces.includes(g))));
  console.log('   sample:', s.tribes.map((t: any) => `${t.name}[sell:${t.produces.join('/')}]`).join('  '));
}

// 3. Per-turn trade income uses produces
{
  const s = createGame(1607, 'england');
  const tri: any = s.tribes[0];
  tri.produces = ['furs', 'wheat', 'tobacco'];
  tri.stance['england'] = 0;
  s.towns.length = 0; // isolate income to trade
  const incBefore = s.income['england'];
  // open trade and run one processTribe via endTurn (but no towns => no other income)
  tri.trade['england'] = true;
  endTurn(s);
  while (s.pendingEvents.length > 0) { const e = s.pendingEvents[0]; if (!eventChoice(s, e.id, 0)) break; }
  const incAfter = s.income['england'];
  check('trade income reflects produces (furs+wheat+tobacco)', incAfter - incBefore > 0);
}

// 4. sellToTribe: player sells a wanted good, tribe pays + standing rises
{
  const s = createGame(1607, 'england');
  foundTown(s, 'england', s.units.find((u: any) => u.owner === 'england')!.id);
  const town = s.towns[0];
  const tri: any = s.tribes[0];
  // make the tribe want iron and stock the town with iron
  tri.wants = ['iron', 'spices'];
  town.stock.iron = 5;
  const stanceBefore = tri.stance['england'] ?? 0;
  const treasBefore = s.treasury['england'];
  const err = sellToTribe(s, 'england', 0, 'iron');
  check('sellToTribe succeeds for a wanted good', err === null);
  check('good deducted from town stock', town.stock.iron === 4);
  check('tribe pays the player', s.treasury['england'] > treasBefore);
  check('standing rises', (tri.stance['england'] ?? 0) > stanceBefore);
  const err2 = sellToTribe(s, 'england', 0, 'wheat');
  check('sellToTribe refuses a good they do not want', err2 !== null);
}

console.log(`\nTRIBE TRADE TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
