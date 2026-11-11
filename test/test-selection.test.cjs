const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const selection = require('../src/test-selection.cjs');

test('discovers nested Vitest config variants without following symlinks or dependencies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const names = ['vitest.config.ts', 'packages/app/vitest.e2e.config.mjs', '.hidden/vitest.unit.config.cts',
    'node_modules/vitest.config.js', '.git/vitest.config.js', 'vite.config.js', 'vitest.config.d.ts', 'vitest.config.json'];
  for (const name of names) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), '');
  }
  await fs.symlink(root, path.join(root, 'loop'), 'dir');
  assert.deepEqual(await selection.discoverConfigs(root), names.slice(0, 3).map(name => path.join(root, name)).sort());
});

test('nested selected configs preserve the caller root and continue after a failed suite', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-selected-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['a', 'b', 'c']) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'vitest.config.mjs'), `export default { test: { globals: true, include: ['${name}/**/*.test.js'] } };`);
    await fs.writeFile(path.join(root, name, 'suite.test.js'), `test('${name}', () => expect(true).toBe(${name !== 'a'}));`);
  }
  const result = spawnSync(process.execPath, ['-e', `
    const selection = require(${JSON.stringify(require.resolve('../src/test-selection.cjs'))});
    selection.selectConfigs = async configs => configs.filter(file => !file.includes('/c/'));
    selection.runTestCommand({}).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /1 failed/);
  assert.match(result.stdout, /1 passed/);
  assert.doesNotMatch(result.stdout, /c\/suite/);

  const cli = path.resolve(__dirname, '../src/cli.cjs');
  const nonInteractive = spawnSync(process.execPath, [cli, 'test'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(nonInteractive.status, 1);
  assert.match(nonInteractive.stderr, /--config PATH/);
});
