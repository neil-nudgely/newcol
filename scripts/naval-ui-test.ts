import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?seed=1607');
await page.waitForSelector('#btn-begin');
await page.click('#btn-begin');
await page.waitForTimeout(400);
const out = await page.evaluate(() => {
  const g = (window as any).__game;
  const o: any = {};
  g.foundAtStart();
  g.endTurn();
  g.buildDock();
  for (let i = 0; i < 10; i++) g.endTurn(); // dock completes + accrue income
  const town = g.state.towns.find((x: any) => x.owner === 'england');
  g.state.treasury.england = 200; // test the UI, not the economy
  o.dock = town.improvements.includes('dock');
  // train a frigate (needs water adjacent — the start is coastal)
  o.trainErr = g.train(town.id, 'frigate');
  const fr = g.state.units.find((u: any) => u.kind === 'frigate' && u.owner === 'england');
  o.frigateExists = !!fr;
  o.hudSettlers = document.getElementById('stat-settlers')?.textContent;
  // select the frigate and read its panel
  if (fr) {
    g.selectTile(fr.q, fr.r);
    // may need to cycle to the frigate if stacked
    let panel = document.getElementById('ctx-body')!.textContent!;
    for (let i = 0; i < 5 && !panel.includes('Frigate'); i++) { g.selectTile(fr.q, fr.r); panel = document.getElementById('ctx-body')!.textContent!; }
    o.panelHasFrigate = panel.includes('Frigate');
    o.panelHead = panel.slice(0, 200);
  }
  return o;
});
console.log(JSON.stringify(out, null, 1));
const ok = out.frigateExists && out.panelHasFrigate && /frigate/i.test(out.hudSettlers ?? '');
console.log(ok ? 'NAVAL UI: PASS' : 'NAVAL UI: FAIL');
console.log('errors:', errors.length === 0 ? 'none' : errors);
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
