// Runs the playwright-based suites (browser-test.ts plus the *-ui-test/*-picker/*-save-load
// scripts that drive a page) against the running dev server.
// Usage: npm run dev (in another shell) && npm run test:browser [name-subset]
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const only = process.argv.slice(2);
const files = readdirSync(resolve(root, 'scripts'))
  .filter((f) => f.endsWith('.ts') && readFileSync(resolve(root, 'scripts', f), 'utf8').includes("'playwright'"))
  .filter((f) => !only.length || only.some((o) => f.includes(o)))
  .sort();

let failed = [];
for (const f of files) {
  const name = f.replace(/\.ts$/, '');
  const out = resolve(root, `.tmp-${name}.mjs`);
  console.log(`— ${name}`);
  try {
    execSync(
      `npx esbuild scripts/${f} --bundle --platform=node --format=esm --packages=external --outfile=${out} --log-level=error`,
      { cwd: root, stdio: 'pipe' },
    );
    execSync(`node ${out}`, { cwd: root, stdio: 'inherit', timeout: 300000 });
  } catch {
    failed.push(name);
  } finally {
    rmSync(out, { force: true });
  }
}
console.log(`\n${files.length - failed.length}/${files.length} browser suites passed${failed.length ? ` — FAILED: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
