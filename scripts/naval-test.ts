import { createGame } from '../src/sim/state';
import {
  endTurn, foundTown, buildImprovement, sendShip, trainUnit, bombardFrigate,
} from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  cond ? pass++ : fail++;
};

const s = createGame(1607);
const first = s.units.find((u) => u.owner === 'england')!;
foundTown(s, 'england', first.id);
const town = s.towns.find((t) => t.owner === 'england')!;
// build dock immediately (bypass construction timer for the test)
town.improvements.push('dock');
town.stock.tobacco = 24;

// place a water tile next to the town to act as frigate positions
const water = s.tiles.filter((t) => t.terrain === 'ocean' || t.terrain === 'coast')
  .sort((a, b) => hexDist(a.q, a.r, town.q, town.r) - hexDist(b.q, b.r, town.q, town.r))[0];

// 1) France frigate within 2 of the dock -> intercept
s.units.push({ id: 100, owner: 'france', kind: 'frigate', q: water.q, r: water.r, moveLeft: 4, bombardedThisTurn: false });
const fraBefore = s.treasury.france;
const engShipsBefore = s.ships.length;
let err = sendShip(s, town.id, { tobacco: 12 });
check('intercept: no error returned (cargo lost, not a UI error)', err === null);
check('intercept: no ship created', s.ships.length === engShipsBefore);
check('intercept: France plundered ~half the value (12 x price x 0.5)',
  s.treasury.france - fraBefore >= 30 && s.treasury.france - fraBefore <= 70);
check('intercept: stock deducted', town.stock.tobacco === 12);

// 2) England escort frigate within 1 -> protected, duty-free
town.stock.tobacco = 24;
s.units.push({ id: 101, owner: 'england', kind: 'frigate', q: water.q, r: water.r, moveLeft: 4, bombardedThisTurn: false });
const engBefore = s.treasury.england;
err = sendShip(s, town.id, { tobacco: 12 });
check('escort: ship created', s.ships.length === engShipsBefore + 1);
const ship = s.ships[s.ships.length - 1];
check('escort: ship flagged escort', ship.escort === true);
// arrival: duty-free
const price = s.prices.tobacco;
s.ships.forEach((sh) => { if (sh.id === ship.id) sh.voyage = 0; });
endTurn(s);
const gained = s.treasury.england - engBefore;
check(`escort: arrived at full value (~$${Math.round(12 * price)}), not half`,
  gained >= 12 * price - 5 && gained <= 12 * price + 40);

// 3) bombard
const popBefore = town.pop;
err = bombardFrigate(s, 101, town.id);
check('bombard: cannot bombard own town', err !== null);
// make a fake enemy town to bombard
const fake = { ...town, id: 999, owner: 'france' as const, q: water.q, r: water.r, pop: 20 };
s.towns.push(fake as any);
const fakePop = (s.towns.find((t) => t.id === 999) as any).pop;
err = bombardFrigate(s, 101, 999);
const fakePop2 = (s.towns.find((t) => t.id === 999) as any).pop;
check('bombard: success in range', err === null);
check(`bombard: population damaged ${fakePop} -> ${fakePop2}`, fakePop2 < fakePop);
check('bombard: once per turn', bombardFrigate(s, 101, 999) !== null);
check('bombard: resets next turn', (endTurn(s), bombardFrigate(s, 101, 999) === null));

// 4) frigate can't walk on land
const fr = s.units.find((u) => u.id === 101)!;
const land = s.tiles.filter((t) => t.terrain === 'grass' || t.terrain === 'forest')[0];
const { moveUnit } = require('../src/sim/sim');
const moved = moveUnit(s, fr.id, land.q, land.r);
check('frigate: cannot run aground on land', moved !== null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
