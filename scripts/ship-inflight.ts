import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?seed=1607');
await page.waitForSelector('#btn-begin');
await page.click('#btn-begin');
await page.waitForTimeout(500);
const setup = await page.evaluate(() => {
  const g = (window as any).__game;
  g.foundAtStart();
  g.endTurn();
  g.buildDock();
  for (let i = 0; i < 6; i++) g.endTurn();
  const t = g.state.towns.find((x: any) => x.owner === 'england')!;
  const qty: any = {};
  let total = 0;
  for (const k of ['tobacco', 'wheat', 'lumber', 'furs']) {
    const n = Math.min(t.stock[k] ?? 0, 12 - total);
    if (n > 0) { qty[k] = n; total += n; }
  }
  const err = g.ship(t.id, qty);
  return { err, shipId: g.state.ships.find((x: any) => x.owner === 'england')?.id, fromQ: t.q, fromR: t.r };
});
if (setup.err || !setup.shipId) { console.log('setup failed', setup.err); await browser.close(); process.exit(1); }

const result = await page.evaluate(async ({ shipId }: { shipId: number }) => {
  const g = (window as any).__game;
  const firstShip = g.state.ships.find((x: any) => x.id === shipId);
  const route = g.shipRoute(firstShip.fromQ, firstShip.fromR);
  const pts = route.map((c: any) => ({ x: c.q * 1.5, z: Math.sqrt(3) * (c.r + 0.5 * (c.q & 1)) }));
  if (route.length > 1) {
    const lastC = route[route.length - 1];
    const beforeC = route[route.length - 2];
    const dx = lastC.q * 1.5 - beforeC.q * 1.5;
    const dz = Math.sqrt(3) * (lastC.r + 0.5 * (lastC.q & 1)) - Math.sqrt(3) * (beforeC.r + 0.5 * (beforeC.q & 1));
    const len = Math.hypot(dx, dz) || 1;
    pts.push({ x: pts[pts.length - 1].x + (dx / len) * 4, z: pts[pts.length - 1].z + (dz / len) * 4 });
  }
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = acc[acc.length - 1];
  const firstOcean = route.findIndex((c: any) => c.terrain === 'ocean');
  const oceanArc = firstOcean > 0 ? acc[firstOcean] : 0;
  const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
  const samples: Array<{ t: number; err: number; land: boolean }> = [];
  let landCount = 0;
  const start = performance.now();
  while (performance.now() - start < 5000) {
    const sh = g.state.ships.find((x: any) => x.id === shipId);
    const pos = g.shipPos(shipId);
    if (!sh || !pos) break;
    const target = easeOut(sh.t) * total;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < target) i++;
    const f = acc[i] === acc[i - 1] ? 0 : (target - acc[i - 1]) / (acc[i] - acc[i - 1]);
    const ex = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f;
    const ez = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * f;
    const err = Math.hypot(pos.x - ex, pos.z - ez);
    // terrain under mesh: nearest tile
    const s = g.state;
    let bestD = 1e9, bestT = '';
    for (const t of s.tiles) {
      const dx = t.q * 1.5 - pos.x, dz = Math.sqrt(3) * (t.r + 0.5 * (t.q & 1)) - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestT = t.terrain; }
    }
    const land = bestT !== 'ocean' && bestT !== 'coast' && target > oceanArc + 1;
    if (land) landCount++;
    samples.push({ t: Math.round(sh.t * 100) / 100, err: Math.round(err * 1000) / 1000, land });
    await new Promise((r) => setTimeout(r, 250));
  }
  return { samples: samples.filter((s, i) => i % 4 === 0), maxErr: Math.max(...samples.map((s) => s.err)), landFrames: landCount, totalFrames: samples.length };
}, { shipId: setup.shipId });

console.log(`frames sampled: ${result.totalFrames}, land frames: ${result.landFrames}, max pos error: ${result.maxErr}`);
console.log(result.samples.map((s: any) => `t=${s.t} err=${s.err}${s.land ? ' LAND!' : ''}`).join(' '));
await browser.close();
process.exit(result.landFrames === 0 && result.maxErr < 0.1 ? 0 : 1);
