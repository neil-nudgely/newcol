import { chromium } from 'playwright';

const SEEDS = [1607, 1610, 1622, 1641, 1655, 1666];
const browser = await chromium.launch();
let failures = 0;

for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://localhost:5173/?seed=${seed}`);
  await page.waitForSelector('#btn-begin');
  await page.click('#btn-begin');
  await page.waitForTimeout(400);

  const report = await page.evaluate(() => {
    const g = (window as any).__game;
    g.foundAtStart();
    const s = g.state;
    const samples: Array<{ q: number; r: number; tag: string }> = [];
    for (const t of s.towns) samples.push({ q: t.q, r: t.r, tag: t.name });
    // every settleable tile (where a town + dock could exist), sampled
    for (const t of s.tiles) {
      if ((t.terrain === 'grass' || t.terrain === 'forest' || t.terrain === 'hills') && (t.q * 7 + t.r * 13) % 3 === 0) {
        samples.push({ q: t.q, r: t.r, tag: `${t.terrain}` });
      }
    }
    samples.push({ q: Math.floor(s.mapW / 2), r: Math.floor(s.mapH / 2), tag: 'center' });
    let maxLand = 0;
    const bad: string[] = [];
    for (const p of samples) {
      const route = g.shipRoute(p.q, p.r);
      if (route.length === 0) {
        bad.push(`${p.tag}@${p.q},${p.r}: EMPTY`);
        continue;
      }
      const firstOcean = route.findIndex((c: any) => c.terrain === 'ocean');
      if (firstOcean === -1) {
        bad.push(`${p.tag}@${p.q},${p.r}: NO OCEAN (${route.length} cells, last=${route[route.length - 1].terrain})`);
        continue;
      }
      maxLand = Math.max(maxLand, firstOcean);
      const landAfter = route.slice(firstOcean).filter((c: any) => c.terrain !== 'ocean' && c.terrain !== 'off');
      if (landAfter.length > 0) bad.push(`${p.tag}@${p.q},${p.r}: LAND AFTER OCEAN: ${landAfter.map((c: any) => c.terrain).join(',')}`);
    }
    return { n: samples.length, maxLand, bad };
  });
  console.log(`seed ${seed}: ${report.n} sample tiles, max land-prefix ${report.maxLand}, problems: ${report.bad.length}`);
  for (const b of (report as any).bad.slice(0, 8)) console.log(`  ${b}`);
  failures += (report as any).bad.length;
  await page.close();
}
await browser.close();
console.log(failures === 0 ? 'ALL ROUTES CLEAN' : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
