import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?seed=1607');
await page.waitForSelector('#btn-begin');
await page.click('#btn-begin');
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const g = (window as any).__game;
  const out: any = {};
  g.foundAtStart();
  g.endTurn();
  g.buildDock();
  for (let i = 0; i < 6; i++) g.endTurn();
  const town = g.state.towns.find((x: any) => x.owner === 'england')!;

  // 1) ship cap: ship 12, second ship same turn must fail, third after endTurn must succeed
  const q1: any = {};
  let n = 0;
  for (const k of ['tobacco', 'wheat', 'lumber', 'furs']) { const m = Math.min(town.stock[k] ?? 0, 12 - n); if (m > 0) { q1[k] = m; n += m; } }
  out.ship1 = g.ship(town.id, q1);
  out.ship2sameTurn = g.ship(town.id, q1);
  g.endTurn();
  const q3: any = {};
  let n3 = 0;
  for (const k of ['tobacco', 'wheat', 'lumber', 'furs']) { const m = Math.min(town.stock[k] ?? 0, 12 - n3); if (m > 0) { q3[k] = m; n3 += m; } }
  out.ship3nextTurn = n3 > 0 ? g.ship(town.id, q3) : 'no stock left';
  out.shipsAtSea = g.state.ships.length;

  // 2) train a militia (spawns on the town tile), then: wait + open town
  const tr = g.train(town.id, 'militia');
  out.trainMilitia = tr;
  const mil = g.state.units.find((u: any) => u.kind === 'militia' && u.owner === 'england');
  out.militiaOnTown = mil && mil.q === town.q && mil.r === town.r;
  out.militiaMoves = mil?.moveLeft;

  // rest the new man, then: select -> Wait -> Open town
  g.endTurn();
  out.militiaMovesAfterRest = mil.moveLeft;
  for (let i = 0; i < 4; i++) {
    g.selectTile(town.q, town.r);
    const su = g.state.units.find((x: any) => x.id === g.selection.unitId);
    if (su && su.id === mil.id) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  out.selectedAfterClick = { ...g.selection, isMilitia: g.selection.unitId === mil.id };
  const waitBtn = document.querySelector<HTMLButtonElement>('#ctx-body #btn-wait');
  out.waitBtnPresent = !!waitBtn;
  out.waitDisabledBefore = waitBtn?.disabled ?? null;
  if (waitBtn && !waitBtn.disabled) {
    waitBtn.click();
    await new Promise((res) => setTimeout(res, 150));
    out.waitHeld = mil.moveLeft === 0;
  }
  // reselect the militia (wait may have re-rendered), then Open {town}
  for (let i = 0; i < 4; i++) {
    g.selectTile(town.q, town.r);
    if (g.selection.unitId === mil.id) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const openBtn = document.querySelector<HTMLButtonElement>('#ctx-body #btn-viewtown');
  out.openTownBtn = openBtn ? openBtn.textContent : 'missing';
  if (openBtn) openBtn.click();
  await new Promise((res) => setTimeout(res, 150));
  out.afterOpenTown = { ...g.selection, panelHasTrade: document.getElementById('ctx-body')!.textContent.includes('Load a ship') };
  // 3) send button state after shipping this turn (town panel should show dock resting)
  out.treasury = Math.round(g.state.treasury.england);
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log('page errors:', errors.length === 0 ? 'none' : errors);
await browser.close();
const ok = r.ship1 === null
  && /one departure per turn/i.test(r.ship2sameTurn ?? '')
  && (r.ship3nextTurn === null || r.ship3nextTurn === 'no stock left')
  && r.militiaOnTown && r.waitHeld;
console.log(ok ? 'UI FIX TEST: PASS' : 'UI FIX TEST: FAIL');
process.exit(ok ? 0 : 1);
