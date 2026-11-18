import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?seed=1607');
await page.waitForSelector('#btn-begin');
await page.click('#btn-begin');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g = (window as any).__game;
  g.foundAtStart();
  g.endTurn();
  g.buildDock();
  for (let i = 0; i < 12; i++) g.endTurn();
  const t = g.state.towns.find((x: any) => x.owner === 'england')!;
  const qty: any = {};
  let n = 0;
  for (const k of ['tobacco', 'wheat', 'lumber', 'furs']) { const m = Math.min(t.stock[k] ?? 0, 12 - n); if (m > 0) { qty[k] = m; n += m; } }
  if (n > 0) g.ship(t.id, qty);
});
// resolve any pending event modals (real clicks)
for (let i = 0; i < 6; i++) {
  const hasChoice = await page.$('#modal:not(.hidden) .ev-choices button');
  if (!hasChoice) break;
  await hasChoice.click();
  await page.waitForTimeout(250);
}
// save mid-voyage
await page.click('#btn-save');
await page.waitForTimeout(300);
const saved = await page.evaluate(() => {
  const g = (window as any).__game;
  return { year: g.state.year, towns: g.state.towns.length, exportValue: g.state.exportValue, ships: g.state.ships.length, rngCalls: g.state.rngCalls };
});
console.log('saved state:', JSON.stringify(saved));
// hard reload — game should be at intro with a Load button
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const loadBtnVisible = await page.isVisible('#btn-load-intro');
console.log('intro shows load button:', loadBtnVisible);
await page.click('#btn-load-intro');
await page.waitForTimeout(500);
const restored = await page.evaluate(() => {
  const g = (window as any).__game;
  return { year: g.state.year, towns: g.state.towns.length, exportValue: g.state.exportValue, ships: g.state.ships.length, rngCalls: g.state.rngCalls, hud: document.getElementById('stat-year')?.textContent };
});
console.log('restored state:', JSON.stringify(restored));
// continue 5 turns after load and verify the sim still runs (rng advanced, no crash)
await page.evaluate(() => { const g = (window as any).__game; for (let i = 0; i < 5; i++) g.endTurn(); });
const after = await page.evaluate(() => {
  const g = (window as any).__game;
  return { year: g.state.year, rngCalls: g.state.rngCalls, priceTobacco: g.state.prices.tobacco };
});
console.log('after 5 post-load turns:', JSON.stringify(after));
const match = saved.year === restored.year && saved.towns === restored.towns && saved.exportValue === restored.exportValue && saved.ships === restored.ships && saved.rngCalls === restored.rngCalls;
console.log(match ? 'SAVE/LOAD: PASS' : 'SAVE/LOAD: FAIL');
console.log('errors:', errors.length === 0 ? 'none' : errors);
await browser.close();
process.exit(match && errors.length === 0 ? 0 : 1);
