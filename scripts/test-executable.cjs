const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  const binary = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../dist/rspack-runner');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-executable-'));
  try {
    const bin = path.join(root, 'bin');
    await fs.mkdir(bin);
    const executable = path.join(bin, 'rspack-runner');
    await fs.copyFile(binary, executable);
    await fs.chmod(executable, 0o755);
    await fs.mkdir(path.join(root, 'cases', 'nested'), { recursive: true });
    await fs.mkdir(path.join(root, 'outside'));
    await fs.writeFile(path.join(root, 'cases', 'nested', 'runtime.test.ts'), `
import { test, expect } from 'vitest';
import { createRequire } from 'node:module';
const runnerRequire = createRequire(process.execPath);
test('embedded Node and native dependencies', async () => {
  expect(process.versions.node).toBe('26.13.0');
  const { rspack } = runnerRequire('@rspack/core');
  const compiler = rspack({ context: ${JSON.stringify(root)}, mode: 'production', target: 'node', entry: './main.js', output: { path: ${JSON.stringify(path.join(root, 'out'))} } });
  try {
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
    expect(stats.hasErrors()).toBe(false);
  } finally { await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve())); }
  const sass = runnerRequire('sass-embedded');
  expect(sass.compileString('a { color: red; }').css).toContain('color: red');
  const { API } = await import(runnerRequire.resolve('tsrs/unstable/async'));
  const api = new API({ cwd: ${JSON.stringify(root)} });
  try { expect((await api.transpileModule('const value: number = 1', { fileName: 'probe.ts' })).outputText).not.toContain(': number'); }
  finally { await api.close(); }
});
`);
    await fs.writeFile(path.join(root, 'main.js'), 'module.exports = 42;');
    await fs.writeFile(path.join(root, 'cases', 'sum.spec.js'), "import { test, expect } from 'vitest'; test('sum', () => expect(2 + 2).toBe(4));");
    await fs.writeFile(path.join(root, 'outside', 'fail.test.mjs'), "import { test, expect } from 'vitest'; test('failure exit code', () => expect(true).toBe(false));");
    const run = args => spawnSync(executable, args, { cwd: root, env: { ...process.env, PATH: bin }, encoding: 'utf8', timeout: 60_000 });
    const help = run(['--help']);
    assert.equal(help.status, 0, help.stdout + help.stderr);
    assert.match(help.stdout, /rspack-runner test/);
    const passed = run(['test', 'cases']);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.match(passed.stdout, /2 passed/);
    const failed = run(['test', 'outside']);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout + failed.stderr, /failure exit code/);
    await fs.writeFile(path.join(root, 'vitest.config.ts'), "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['cases/**/*.spec.js'], globals: true } });");
    const configured = run(['test', 'cases']);
    assert.equal(configured.status, 0, configured.stdout + configured.stderr);
    assert.match(configured.stdout, /1 passed/);
    console.log('Standalone executable passed: no system Node, nested JS/TS tests, native Rspack/Sass/tsrs, failure exit code.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
