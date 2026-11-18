import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?seed=1607&player=england');
await page.waitForSelector('#btn-begin');
await page.click('#btn-begin');
await page.waitForTimeout(400);

// Research button shows 0/6 at start
const btnText = await page.$eval('#btn-research', (e) => e.textContent);
console.log('research button:', btnText);

// Give insight via dev hook and open the modal
await page.evaluate(() => {
  const g = (window as any).__game;
  g.state.insight[g.state.player] = 60;
  g.refresh();
});
await page.click('#btn-research');
await page.waitForTimeout(200);
const rows = await page.$$eval('.tech-row', (els) => els.map((e) => e.className));
console.log('tech rows:', JSON.stringify(rows));
const insightStat = await page.$eval('#stat-insight', (e) => e.textContent);
console.log('insight stat:', insightStat);

// Buy Crop Rotation (fallow, cost 8, era 1) — should be enabled with 60 insight
const fallowBtn = await page.$('[data-tech="fallow"]');
const fallowDisabled = fallowBtn ? await fallowBtn.isDisabled() : true;
console.log('fallow buy disabled?', fallowDisabled);
if (fallowBtn && !fallowDisabled) await fallowBtn.click();
await page.waitForTimeout(150);

// And send for Columbus (founder, cost 10)
const colBtn = await page.$('[data-founder="columbus"]');
if (colBtn) await colBtn.scrollIntoViewIfNeeded();
const colBtn2 = await page.$('[data-founder="columbus"]');
if (colBtn2 && !(await colBtn2.isDisabled())) await colBtn2.click();
await page.waitForTimeout(150);

const out = await page.evaluate(() => {
  const g = (window as any).__game;
  const p = g.state.player;
  return { researched: g.state.researched[p], founders: g.state.founders[p], insight: g.state.insight[p], insightStat: document.getElementById('stat-insight')?.textContent };
});
console.log('after buy:', JSON.stringify(out));

const ok = btnText.includes('Learning 0/16')
  && rows.length === 16
  && !fallowDisabled
  && out.researched.includes('fallow') && out.founders.includes('columbus')
  && Math.round(out.insight) === 42
  && errors.length === 0;
console.log(ok ? 'RESEARCH UI: PASS' : 'RESEARCH UI: FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
