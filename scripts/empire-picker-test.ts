import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?seed=1607');
await page.waitForSelector('#btn-begin');
await page.waitForTimeout(300);

// empire options rendered?
const opts = await page.$$eval('.empire-opt', (els) => els.map((e) => (e as HTMLElement).dataset.empire));
console.log('empire options:', JSON.stringify(opts));
// rival-count options rendered?
const rivalOpts = await page.$$eval('.rival-opt', (els) => els.map((e) => e.dataset.rivals));
console.log('rival-count options:', JSON.stringify(rivalOpts));

// pick Portugal + THREE rivals
await page.click('.empire-opt[data-empire="portugal"]');
await page.click('.rival-opt[data-rivals="3"]');
await page.waitForTimeout(150);
const chosen = await page.$eval('.empire-opt.chosen', (e) => (e as HTMLElement).dataset.empire);
const chosenRivals = await page.$eval('.rival-opt.chosen', (e) => e.dataset.rivals);
console.log('chosen:', chosen, 'rivals:', chosenRivals);
await page.click('#btn-begin');
await page.waitForTimeout(500);
const out = await page.evaluate(() => {
  const g = (window as any).__game;
  const st = g.state;
  const settlers = (o: string) => st.units.filter((u: any) => u.owner === o && u.kind === 'settler').length;
  return {
    player: st.player,
    rivals: st.rivals,
    brand: document.getElementById('brand-empire')?.textContent,
    tribes: st.tribes.map((t: any) => t.name),
    rivalSettlers: st.rivals.map((r: string) => settlers(r)),
  };
});
console.log('after begin:', JSON.stringify(out));

const allNine = ['england', 'france', 'spain', 'netherlands', 'sweden', 'portugal', 'denmark', 'prussia', 'russia'];
const ok =
  opts.length === 9 && allNine.every((e) => opts.includes(e))
  && rivalOpts.includes('1') && rivalOpts.includes('2') && rivalOpts.includes('3')
  && chosen === 'portugal' && chosenRivals === '3'
  && out.player === 'portugal'
  && out.rivals.length === 3 && out.rivals[0] === 'spain'
  && new Set(out.rivals).size === 3 && !out.rivals.includes('portugal')
  && out.rivalSettlers.every((n: number) => n === 3)
  && out.brand === 'Portugal'
  && out.tribes.includes('Apalachee') && out.tribes.includes('Creek')
  && errors.length === 0;
console.log(ok ? 'EMPIRE PICKER: PASS' : 'EMPIRE PICKER: FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
