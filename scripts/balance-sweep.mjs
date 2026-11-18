// Multi-seed balance sweep: plays scripts/smoke.ts (bot) across seeds and reports victories.
// Usage: node scripts/balance-sweep.mjs [seeds...]
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const seeds = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const list = seeds.length ? seeds : [1, 2, 3, 5, 7, 11, 13, 1607, 2024, 12345];
const out = resolve(root, '.tmp-smoke.mjs');

try {
  execSync(`npx esbuild scripts/smoke.ts --bundle --platform=node --format=esm --outfile=${out} --log-level=error`, { cwd: root, stdio: 'pipe' });
  const rows = [];
  for (const seed of list) {
    const log = execSync(`node ${out} ${seed}`, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 300000 });
    const m = /final year: (\d+) victory: (.*)/.exec(log);
    const v = m && m[2] !== 'null' ? JSON.parse(m[2]) : null;
    rows.push({ seed, year: v?.year ?? '—', kind: v?.kind ?? 'none' });
  }
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const years = rows.filter((r) => r.year !== '—').map((r) => Number(r.year));
  for (const r of rows) console.log(`seed ${String(r.seed).padEnd(6)} ${String(r.kind).padEnd(12)} ${r.year}`);
  console.log(`\nkinds: ${JSON.stringify(byKind)}`);
  if (years.length) console.log(`victories: ${years.length}/${rows.length}  earliest ${Math.min(...years)}  latest ${Math.max(...years)}  mean ${Math.round(years.reduce((a, b) => a + b, 0) / years.length)}`);
} finally {
  rmSync(out, { force: true });
}
