import { createGame } from '../src/sim/state';
import { endTurn, mBuy, mSell, sendShip } from '../src/sim/sim';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };

// A: fresh board sits at the base prices; buying costs the spread over selling.
{
  const s = createGame(1607);
  check('A1 sell prices start at base', mSell(s, 'england', 'tobacco') === 8 && mSell(s, 'england', 'furs') === 6);
  check('A2 buy = sell + spread', mBuy(s, 'england', 'wheat') === mSell(s, 'england', 'wheat') + 3 && mBuy(s, 'england', 'silver') === mSell(s, 'england', 'silver') + 1);
}

// B: dumping a cargo crashes the price — one mark per season, and only in YOUR market.
{
  const s = createGame(1607);
  const fraBefore = mSell(s, 'france', 'furs');
  s.supply.england.furs = 200;
  endTurn(s);
  check('B1 first season after a flood: price down exactly one', mSell(s, 'england', 'furs') === 5);
  endTurn(s); endTurn(s);
  check('B2 it keeps sliding', mSell(s, 'england', 'furs') < 5);
  check('B3 the French market never felt it', mSell(s, 'france', 'furs') === fraBefore);
}

// C: an unworked market runs short and the price climbs back — capped for New World goods.
{
  const s = createGame(1607);
  s.supply.england.furs = 200;
  for (let i = 0; i < 90; i++) endTurn(s);
  const furs = mSell(s, 'england', 'furs');
  check(`C1 furs recovered toward base and stop at the New World cap (+2) [got ${furs}]`, furs === 8);
  // wheat is not a New World crop in Europe's eyes: it can drift above its base
  for (let i = 0; i < 60; i++) endTurn(s);
  check(`C2 an untouched Old World good rises above base [got ${s.prices.wheat}]`, s.prices.wheat >= 6);
}

// D: a ship is valued at ARRIVAL prices in the owner's market.
{
  const s = createGame(1607);
  const before = s.treasury.england;
  const price = mSell(s, 'england', 'tobacco');
  s.ships.push({ id: 1, owner: 'england', fromQ: 0, fromR: 0, good: 'tobacco', amount: 12, t: 0, voyage: 1, value: 0, escort: true, cargo: { tobacco: 12 }, townName: 'Jamestown' } as any);
  endTurn(s);
  const earned = s.income.england;
  check(`D1 escorted cargo paid at arrival price [earned ${earned}]`, Math.abs(earned - 12 * price) <= 2);
  endTurn(s);
  check('D2 and the delivered tobacco now weighs on the English market', mSell(s, 'england', 'tobacco') <= price - 1);
}

// E: the Custom House widens a town's season on the European market.
{
  const s = createGame(1607);
  const stock: Record<string, number> = {};
  stock.muskets = 17;
  const town = { id: 601, name: 'Quedock', owner: 'england', q: s.playerStart.q, r: s.playerStart.r, pop: 2, loyalty: 80, faith: 0, drought: 0, foundedYear: s.year, fed: true, food: 9, improvements: ['dock'], stock, seasonGross: 0, construction: null, trainedThisTurn: false, shippedThisTurn: false, foundedThisTurn: false, immuneUntil: 0, landBought: [] } as any;
  s.towns.push(town);
  const cargo: Record<string, number> = { muskets: 9 };
  const err = sendShip(s as any, town.id, cargo);
  check(`E1 over the plain quota: refused [${err ? 'yes' : 'no'}]`, err !== null && String(err).includes('market factor'));
  town.improvements.push('customhouse');
  const err2 = sendShip(s as any, town.id, cargo);
  const musket = mSell(s, 'england', 'muskets');
  check(`E2 the Custom House takes the load [${err2 ? String(err2).slice(0, 40) : 'none'}]`, err2 === null);
  check(`E3 the ledger marks the season sold [${town.seasonGross} vs ${9 * musket}]`, Math.abs(town.seasonGross - 9 * musket) <= 9);
  town.shippedThisTurn = false;
  town.stock.muskets = 8;
  const err3 = sendShip(s as any, town.id, { muskets: 8 } as any);
  check('E4 and no second season in one season', err3 !== null && String(err3).includes('market factor'));
  endTurn(s);
  check(`E5 the new season resets the ledger [${town.seasonGross}]`, town.seasonGross === 0);
}

console.log(`\nMARKET TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
