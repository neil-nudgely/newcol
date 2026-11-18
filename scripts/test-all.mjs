// Runs every node test script under scripts/ through esbuild and node.
// Usage: node scripts/test-all.mjs [--only name1,name2] [--quiet]
import { readdirSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tmp = resolve(root, '.tmp-tests');
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;

mkdirSync(tmp, { recursive: true });

const files = readdirSync(resolve(root, 'scripts'))
  .filter((f) => f.endsWith('-test.ts') && !f.startsWith('browser-'))
  .filter((f) => !readFileSync(resolve(root, 'scripts', f), 'utf8').includes("'playwright'"))
  .filter((f) => !only || only.some((o) => f.includes(o)))
  .sort();

let failed = [];
const results = [];
for (const f of files) {
  const name = f.replace(/\.ts$/, '');
  const out = resolve(tmp, `${name}.mjs`);
  try {
    execSync(`npx esbuild scripts/${f} --bundle --platform=node --format=esm --outfile=${out} --log-level=error`, { cwd: root, stdio: 'pipe' });
    const log = execSync(`node ${out}`, { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
    const verdict = log.split('\n').filter((l) => /passed|determinism/.test(l)).pop() ?? '(no verdict)';
    const bad = /(\d+) failed/.exec(verdict);
    const ok = !bad || Number(bad[1]) === 0;
    results.push(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${verdict.trim()}`);
    if (!ok) failed.push(name);
  } catch (e) {
    const msg = String(e.stderr ?? e.message).split('\n').slice(-4).join(' / ');
    results.push(`FAIL  ${name.padEnd(22)} ${msg}`);
    failed.push(name);
  }
}
rmSync(tmp, { recursive: true, force: true });
if (!quiet) for (const r of results) console.log(r);
console.log(`\n${files.length - failed.length}/${files.length} suites passed${failed.length ? ` — FAILED: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
