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
});
// advance to 1630, resolving events by real modal clicks (4 seasons per year)
let era2Seen = '';
for (let i = 0; i < 140; i++) {
  const title = await page.evaluate(() => {
    const m = document.getElementById('modal');
    if (m && !m.classList.contains('hidden')) {
      return m.querySelector('.ev-title')?.textContent ?? '';
    }
    return null;
  });
  if (title) {
    if (title.includes('Age of Trade')) era2Seen = title;
    const btn = await page.$('#modal:not(.hidden) .ev-choices button');
    if (btn) { await btn.click(); await page.waitForTimeout(200); continue; }
  }
  const year = await page.evaluate(() => (window as any).__game.state.year);
  if (year >= 1631) break;
  await page.evaluate(() => (window as any).__game.endTurn());
  await page.waitForTimeout(150);
}
const era2 = await page.evaluate(() => {
  const body = (function () {
    const g = (window as any).__game;
    const t = g.state.towns.find((x: any) => x.owner === 'england');
    g.selectTile(t.q, t.r);
    const btn = document.querySelector<HTMLButtonElement>('#ctx-body #btn-viewtown');
    if (btn) btn.click();
    return document.getElementById('ctx-body')!.textContent!;
  })();
  const g = (window as any).__game;
  return {
    hudEra: document.getElementById('stat-era')?.textContent,
    stateEra: g.state.era,
    hasSugarRow: body.includes('Sugar'),
    hasTobaccoBarn: body.includes('Tobacco Barn'),
    barnBuildable: /Tobacco Barn[\s\S]*?Build £40/.test(body),
  };
});
console.log('ERA 2:', JSON.stringify({ era2Seen, ...era2 }));
// advance to 1650
let era3Seen = '';
for (let i = 0; i < 100; i++) {
  const title = await page.evaluate(() => {
    const m = document.getElementById('modal');
    if (m && !m.classList.contains('hidden')) return m.querySelector('.ev-title')?.textContent ?? '';
    return null;
  });
  if (title) {
    if (title.includes('Revolutionary Tide')) era3Seen = title;
    const btn = await page.$('#modal:not(.hidden) .ev-choices button');
    if (btn) { await btn.click(); await page.waitForTimeout(200); continue; }
  }
  const year = await page.evaluate(() => (window as any).__game.state.year);
  if (year >= 1651) break;
  await page.evaluate(() => (window as any).__game.endTurn());
  await page.waitForTimeout(150);
}
const era3 = await page.evaluate(() => {
  const body = (function () {
    const g = (window as any).__game;
    const t = g.state.towns.find((x: any) => x.owner === 'england');
    g.selectTile(t.q, t.r);
    const btn = document.querySelector<HTMLButtonElement>('#ctx-body #btn-viewtown');
    if (btn) btn.click();
    return document.getElementById('ctx-body')!.textContent!;
  })();
  const g = (window as any).__game;
  return {
    hudEra: document.getElementById('stat-era')?.textContent,
    stateEra: g.state.era,
    hasIndigoRow: body.includes('Indigo'),
    hasArtillery: body.includes('Artillery'),
    artBuildable: /Artillery[\s\S]*?Build £80/.test(body),
  };
});
console.log('ERA 3:', JSON.stringify({ era3Seen, ...era3 }));
const ok = era2.hudEra === 'The Age of Trade' && era2.hasSugarRow && era2.barnBuildable
  && era3.hudEra === 'The Revolutionary Tide' && era3.hasIndigoRow && era3.artBuildable;
console.log(ok ? 'ERA TEST: PASS' : 'ERA TEST: FAIL');
console.log('errors:', errors.length === 0 ? 'none' : errors);
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
