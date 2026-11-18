import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
  if (m.text().startsWith('MODAL CLASS') || m.text().startsWith('[+')) console.log(m.text().slice(0, 400));
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/01-intro.png' });

const introVisible = await page.isVisible('#intro');
console.log('intro visible:', introVisible);

await page.evaluate(() => {
  const t0 = performance.now();
  const log = (tag: string) =>
    console.log(`[+${Math.round(performance.now() - t0)}ms] ${tag} cls="${document.getElementById('modal')?.className}" year=${(window as unknown as { __game: { state: { year: number; pendingEvents: unknown[] } } }).__game.state.year} pending=${(window as unknown as { __game: { state: { year: number; pendingEvents: unknown[] } } }).__game.state.pendingEvents.length}`);
  let prev: boolean | null = null;
  setInterval(() => {
    const m = document.getElementById('modal')!;
    const hidden = m.classList.contains('hidden');
    if (prev === null) {
      prev = hidden;
      return;
    }
    if (prev === hidden) return;
    prev = hidden;
    log(hidden ? 'modal HIDDEN' : 'modal SHOWN');
  }, 20);
  (document as unknown as Record<string, unknown>)._logTag = log;
  window.addEventListener('click', (e) => log('click ' + (e.target as Element)?.tagName + '#' + (e.target as Element)?.id), true);
});
await page.click('#btn-begin');
await page.waitForTimeout(800);
console.log('intro after begin:', await page.isVisible('#intro'));
await page.screenshot({ path: 'shots/02-map.png' });

type Game = {
  state: {
    units: Array<{ id: number; owner: string; q: number; r: number; moveLeft: number; kind: string }>;
    towns: Array<{ id: number; owner: string; q: number; r: number; stock: Record<string, number>; improvements: string[] }>;
    tiles: Array<{ q: number; r: number; terrain: string }>;
    mapW: number;
    mapH: number;
    playerStart: { q: number; r: number };
    treasury: Record<string, number>;
    ships: Array<{ id: number }>;
  };
  foundAtStart: () => void;
  buildDock: () => void;
  reachable: (id: number) => Array<{ q: number; r: number; cost: number }>;
  screenPos: (q: number, r: number) => { x: number; y: number } | null;
  pickAtScreen: (x: number, y: number) => { q: number; r: number } | null;
  hexDist: (q1: number, r1: number, q2: number, r2: number) => number;
  selectTile: (q: number, r: number) => void;
  selectNoMove: (q: number, r: number) => void;
  selection: unknown;
};
// 1) unit panel should be showing (auto-selected first settler)
const unitPanel1 = await page.$eval('#ctx-body', (el) => el.textContent ?? '');
console.log('unit panel shows settler:', unitPanel1.includes('Settler'), '| moves:', /Moves left: (\d)/.exec(unitPanel1)?.[1]);

// 2) stack cycling: three settlers on the start tile; clicking it cycles the selection
const cycle = await page.evaluate(() => {
  const g = (window as unknown as { __game: Game }).__game;
  const s = g.state;
  const pos = g.screenPos(s.playerStart.q, s.playerStart.r);
  return { pos, ids: s.units.filter((u) => u.owner === 'england').map((u) => u.id) };
});
if (cycle.pos) {
  const seq: Array<number | null> = [];
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(cycle.pos.x, cycle.pos.y);
    await page.waitForTimeout(200);
    seq.push((await page.evaluate(() => (window as unknown as { __game: { selection: { unitId: number | null } } }).__game.selection)).unitId);
  }
  console.log('cycle sequence (expect ids rotating, then repeat):', JSON.stringify(seq), 'unit ids:', JSON.stringify(cycle.ids));
}

// 3) found Jamestown with the first unit (consumes a settler from the start stack)
await page.evaluate(() => (window as unknown as { __game: Game }).__game.foundAtStart());
await page.waitForTimeout(400);

// 4) step-march a second settler toward a far settleable target, then found there
const plan = await page.evaluate(() => {
  const g = (window as unknown as { __game: Game }).__game;
  const s = g.state;
  const u = s.units.find((x) => x.owner === 'england');
  if (!u) return { err: 'no unit' };
    const reach = g.reachable(u.id).filter((rc) => {
      const t = s.tiles[rc.r * s.mapW + rc.q];
      return t && new Set(['grass', 'forest']).has(t.terrain) && g.hexDist(rc.q, rc.r, s.playerStart.q, s.playerStart.r) >= 2;
    });
    reach.sort((a, b) => b.cost - a.cost);
    const target = reach[0] ?? null;
    return {
      uid: u.id,
      at: { q: u.q, r: u.r },
      atPos: g.screenPos(u.q, u.r),
      to: target ? { q: target.q, r: target.r, cost: target.cost } : null,
      toPos: target ? g.screenPos(target.q, target.r) : null,
    };
  });
console.log('march plan:', JSON.stringify(plan));
if (plan.atPos && plan.to && plan.toPos) {
  // make sure the planned unit is the selected one (clicking its tile cycles the stack)
  for (let i = 0; i < 4; i++) {
    const cur = (await page.evaluate(() => (window as unknown as { __game: { selection: { unitId: number | null } } }).__game.selection)).unitId;
    if (cur === plan.uid) break;
    await page.mouse.click(plan.atPos.x, plan.atPos.y);
    await page.waitForTimeout(250);
  }
  const selInfo = await page.evaluate(() => (window as unknown as { __game: { selection: { unitId: number | null } } }).__game.selection);
  console.log('selected unit aligned:', selInfo.unitId === plan.uid);

  // one click on the destination -> the unit walks exactly that far (cost = distance)
  await page.mouse.click(plan.toPos.x, plan.toPos.y);
  await page.waitForTimeout(600);
  const afterMove = await page.evaluate((uid) => {
    const g = (window as unknown as { __game: Game }).__game;
    const un = g.state.units.find((x) => x.id === uid);
    return un ? { q: un.q, r: un.r, moveLeft: un.moveLeft } : null;
  }, plan.uid);
  const arrived = afterMove && plan.to && afterMove.q === plan.to.q && afterMove.r === plan.to.r;
  console.log('unit after one click:', JSON.stringify(afterMove), '| arrived at destination:', arrived, '| expected moveLeft', plan.to ? 3 - plan.to.cost : '?');

  const upos = await page.evaluate((uid) => {
    const g = (window as unknown as { __game: Game }).__game;
    const un = g.state.units.find((x) => x.id === uid);
    return un ? g.screenPos(un.q, un.r) : null;
  }, plan.uid);
  if (upos) {
    await page.mouse.click(upos.x, upos.y);
    await page.waitForTimeout(400);
    const panel = await page.$eval('#ctx-body', (el) => el.textContent ?? '');
    const offers = panel.includes('Found a Town here');
    console.log('panel offers found:', offers);
    if (offers && await page.isVisible('#btn-found')) {
      await page.click('#btn-found');
      await page.waitForTimeout(400);
    }
  }
  const left = await page.evaluate(() => (window as unknown as { __game: Game }).__game.state.units.filter((x) => x.owner === 'england').length);
  const townsN = await page.evaluate(() => (window as unknown as { __game: Game }).__game.state.towns.filter((x) => x.owner === 'england').length);
  console.log('england units left:', left, 'england towns:', townsN);
}

// (dock is built inside the turn loop at i===1: a new settlement can't start building until the next turn)
let tradeTested = false;
let dockBuilt = false;
let sendTreasury: number | null = null;
let resolved = 0;
for (let i = 0; i < 30; i++) {
  if ((i === 1 || i === 3) && !dockBuilt) {
    const canBuild = await page.evaluate(() => {
      const g = (window as unknown as { __game: Game }).__game;
      const t = g.state.towns.find((x) => x.owner === 'england');
      return !!t && !t.improvements.includes('dock') && !t.construction && g.state.treasury.england >= 50;
    });
    if (canBuild) {
      dockBuilt = true;
      await page.evaluate(() => (window as unknown as { __game: Game }).__game.buildDock());
      await page.waitForTimeout(200);
      console.log(`dock construction started at i=${i} (builds over 2 turns)`);
    }
  }
  const introCls = await page.evaluate(() => document.getElementById('intro')?.className);
  if (introCls && !introCls.includes('hidden') && i > 0) {
    const details = await page.evaluate(() => ({
      introClass: document.getElementById('intro')?.className,
      hudClass: document.getElementById('hud')?.className,
      uiChildren: Array.from(document.getElementById('ui')?.children ?? []).map((c) => (c as HTMLElement).id + ':' + (c as HTMLElement).className),
    }));
    console.log(`iter ${i}: intro REAPPEARED`, JSON.stringify(details));
    break;
  }
  const modalVisible = await page.isVisible('#modal');
  const pending = await page.evaluate(
    () => (window as unknown as { __game: { state: { year: number; pendingEvents: unknown[] } } }).__game.state.pendingEvents.length,
  );
  if (modalVisible || pending > 0) {
    console.log(`iter ${i}: modalVisible=${modalVisible} pending=${pending} year=${await page.evaluate(() => (window as unknown as { __game: { state: { year: number } } }).__game.state.year)}`);
  }
  const choice = modalVisible ? await page.$('#modal .ev-choices button') : null;
  if (choice) {
    await choice.click();
    resolved++;
    console.log(`iter ${i}: resolved choice #${resolved}`);
    await page.waitForTimeout(250);
  }
  const disabled = await page.$eval('#btn-endturn', (b) => (b as HTMLButtonElement).disabled).catch(() => true);
  if (!disabled) {
    try {
      await page.click('#btn-endturn', { timeout: 4000 });
      const after = await page.evaluate(() => {
        const s = (window as unknown as { __game: { state: { year: number; pendingEvents: Array<{ kind: string; title: string }> } } }).__game.state;
        return s.pendingEvents.map((e) => `${e.kind}:${e.title}`);
      });
      if (after.length > 0) console.log(`iter ${i} NEW PENDING after endturn (year ${await page.evaluate(() => (window as unknown as { __game: { state: { year: number } } }).__game.state.year)}):`, JSON.stringify(after));
    } catch {
      const dump = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('#intro'));
        const btn = document.getElementById('btn-endturn')!;
        const b = btn.getBoundingClientRect();
        const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        const chain: string[] = [];
        let el: Element | null = at;
        while (el && chain.length < 6) {
          chain.push(`${el.tagName}#${el.id}.${String(el.className).slice(0, 40)}`);
          el = el.parentElement;
        }
        return {
          introCount: all.length,
          introClasses: all.map((e) => e.className + ' display=' + getComputedStyle(e).display),
          hitChain: chain,
        };
      });
      console.log('CLICK BLOCKED dump:', JSON.stringify(dump, null, 2));
      break;
    }
  }
  await page.waitForTimeout(120);
  if (i === 4) await page.screenshot({ path: 'shots/03-early.png' });
  if (i === 6 && !tradeTested) {
    tradeTested = true;
    const trade = await page.evaluate(() => {
      const g = (window as unknown as { __game: Game }).__game;
      const s = g.state;
      const town = s.towns.find((t) => t.owner === 'england' && t.improvements.includes('dock'));
      if (!town) return { err: 'no dock town' };
      const totalStock = (['tobacco', 'wheat', 'lumber', 'furs'] as const).reduce((a, k) => a + town.stock[k], 0);
      const unitHere = s.units.find((u) => u.q === town.q && u.r === town.r);
      return {
        townId: town.id,
        q: town.q,
        r: town.r,
        pos: g.screenPos(town.q, town.r),
        stock: { ...town.stock },
        totalStock,
        unitHere: unitHere ? { id: unitHere.id, kind: unitHere.kind } : null,
        reach: unitHere ? g.reachable(unitHere.id).slice(0, 1) : [],
        treasury: s.treasury.england,
      };
    });
    if (!('err' in trade) && trade.pos && trade.totalStock > 0) {
      // walk any unit off the town tile so the town itself can be selected
      for (let k = 0; k < 3; k++) {
        const here = await page.evaluate(({ q, r }) => {
          const g = (window as unknown as { __game: Game }).__game;
          const u = g.state.units.find((x) => x.q === q && x.r === r);
          if (!u) return null;
          const reach = g.reachable(u.id);
          reach.sort((a, b) => b.cost - a.cost);
          return { id: u.id, far: reach[0] ?? null };
        }, { q: trade.q, r: trade.r });
        if (!here) break;
        await page.mouse.click(trade.pos.x, trade.pos.y);
        await page.waitForTimeout(250);
        if (here.far) {
          const p = await page.evaluate(({ q, r }) => (window as unknown as { __game: Game }).__game.screenPos(q, r), here.far);
          if (p) {
            await page.mouse.click(p.x, p.y);
            await page.waitForTimeout(450);
          }
        }
      }
      // select the town without moving any unit (unit walked off already)
      await page.evaluate(({ q, r }) => {
        (window as unknown as { __game: Game }).__game.selectNoMove(q, r);
      }, { q: trade.q, r: trade.r });
      await page.waitForTimeout(400);
      const panel = await page.$eval('#ctx-body', (el) => el.textContent ?? '');
      console.log('town panel shows trade:', panel.includes('Load a ship'));
      const allBtn = await page.$(`#ctx-body [data-qty]:not([disabled])`);
      if (allBtn) {
        // click "all" for the first good with stock
        const all = await page.$$eval('#ctx-body [data-qty]', (btns) => {
          const a = btns.filter((b) => (b as HTMLElement).dataset.d === 'all' && !(b as HTMLButtonElement).disabled);
          if (a.length) (a[0] as HTMLElement).click();
          return a.length > 0;
        });
        await page.waitForTimeout(300);
        console.log('loaded all of a good:', all);
        const sent = await page.evaluate(() => {
          const b = document.getElementById('btn-send');
          if (b && !(b as HTMLButtonElement).disabled) (b as HTMLButtonElement).click();
          return b ? !(b as HTMLButtonElement).disabled : false;
        });
        await page.waitForTimeout(400);
        const after = await page.evaluate((townId) => {
          const g = (window as unknown as { __game: Game }).__game;
          const town = g.state.towns.find((t) => t.id === townId);
          return {
            treasury: g.state.treasury.england,
            ships: g.state.ships.filter((sh) => sh.owner === 'england').length,
            townStock: town ? { ...town.stock } : null,
          };
        }, trade.townId);
        const instantCredit = after.treasury > trade.treasury;
        sendTreasury = after.treasury;
        console.log('send ship:', sent, '| treasury unchanged on send:', !instantCredit, `(${Math.round(trade.treasury)} -> ${Math.round(after.treasury)})`, '| eng ships at sea:', after.ships, '| stock after:', JSON.stringify(after.townStock), '| stock before:', JSON.stringify(trade.stock));
      }
      // training
      const trained = await page.evaluate(() => {
        const g = (window as unknown as { __game: Game }).__game;
        const before = g.state.units.filter((u) => u.owner === 'england').length;
        const b = document.querySelector<HTMLButtonElement>('#ctx-body [data-train="settler"]');
        if (b && !b.disabled) b.click();
        const now = g.state.units.filter((u) => u.owner === 'england').length;
        return { before, now, button: b ? (b.disabled ? 'disabled' : 'clicked') : 'missing' };
      });
      console.log('train settler:', JSON.stringify(trained));
    } else {
      console.log('trade test skipped:', JSON.stringify(trade));
    }
  }

  if (i === 9 && sendTreasury !== null) {
    const now = await page.evaluate(() => (window as unknown as { __game: Game }).__game.state.treasury.england);
    console.log('voyage arrival credit: treasury', Math.round(sendTreasury), '=>', Math.round(now), '| credited on arrival:', now > sendTreasury);
    sendTreasury = null;
  }

  if (i === 14) {
    await page.screenshot({ path: 'shots/04-mid.png' });
    await page.dispatchEvent('#btn-diplo', 'click');
    await page.waitForTimeout(300);
    console.log('diplo open:', await page.isVisible('#modal [data-diplo-close]'));
    await page.screenshot({ path: 'shots/05-diplo.png' });
    await page.dispatchEvent('#btn-diplo', 'click');
    await page.waitForTimeout(200);
  }
  if (i === 28) await page.screenshot({ path: 'shots/06-late.png' });
}

const state = await page.evaluate(() => {
  const s = (window as unknown as { __game: { state: unknown } }).__game.state as Record<string, unknown>;
  const canvas = document.querySelector('#stage canvas');
  const labels = Array.from(document.querySelectorAll('.map-label')).map((l) => l.textContent);
  return {
    year: s.year,
    engTowns: (s.towns as Array<Record<string, unknown>>).filter((t) => t.owner === 'england').length,
    fraTowns: (s.towns as Array<Record<string, unknown>>).filter((t) => t.owner === 'france').length,
    treasury: (s.treasury as Record<string, number>).england,
    loyalty: (s.towns as Array<Record<string, unknown>>).filter((t) => t.owner === 'england').map((t) => Math.round(t.loyalty as number)),
    canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
    labels,
    hudYear: document.getElementById('stat-year')?.textContent,
    hudMoney: document.getElementById('stat-money')?.textContent,
    logLines: document.querySelectorAll('.log-line').length,
  };
});
console.log('state after 30 turns:', JSON.stringify(state));
console.log('events resolved:', resolved);
console.log('ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2));

await browser.close();
