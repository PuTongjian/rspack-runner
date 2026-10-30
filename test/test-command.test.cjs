const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../src/cli.cjs');

test('test command runs nested JS/TS cases only in the selected external directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'cases', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'cases-other'));
  await fs.writeFile(path.join(root, 'cases', 'sum.test.js'), "import { test, expect } from 'vitest'; test('addition', () => expect(1 + 1).toBe(2));");
  await fs.writeFile(path.join(root, 'cases', 'nested', 'sum.spec.ts'), "import { test, expect } from 'vitest'; const value: number = 3; test('typescript', () => expect(value).toBe(3));");
  await fs.writeFile(path.join(root, 'cases-other', 'fail.test.mjs'), "import { test, expect } from 'vitest'; test('outside directory', () => expect(true).toBe(false));");
  const run = args => spawnSync(process.execPath, [cli, 'test', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });

  for (const args of [['cases'], [path.join(root, 'cases')], ['cases', '--project', root]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /2 passed/);
    assert.doesNotMatch(result.stdout, /outside directory/);
  }
  const failure = run(['cases-other']);
  assert.equal(failure.status, 1, failure.stdout + failure.stderr);
  assert.match(failure.stdout + failure.stderr, /outside directory/);
  assert.equal(run([]).status, 1, 'without a directory, all cases under the current project run');

  await fs.mkdir(path.join(root, 'empty'));
  assert.equal(run(['empty']).status, 1, 'no matching test files must fail');
  assert.equal(run(['missing']).status, 1);
  assert.equal(run(['cases/sum.test.js']).status, 1);
  assert.equal(run(['cases', 'cases-other']).status, 1);
  const caller = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-caller-'));
  t.after(() => fs.rm(caller, { recursive: true, force: true }));
  const external = spawnSync(process.execPath, [cli, 'test', path.join(root, 'cases')], { cwd: caller, encoding: 'utf8', timeout: 30_000 });
  assert.equal(external.status, 0, external.stdout + external.stderr);
  assert.match(external.stdout, /2 passed/);
});

test('test command honors discovered and explicit Vitest config while running once', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'cases'));
  await fs.writeFile(path.join(root, 'cases', 'custom.case.js'), "test('configured globals', () => expect('ready').toBe('ready'));");
  const config = "import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { include: ['cases/**/*.case.js'], globals: true, watch: true } });";
  const defaultConfig = path.join(root, 'vitest.config.mjs');
  await fs.writeFile(defaultConfig, config);
  const run = args => spawnSync(process.execPath, [cli, 'test', '--project', root, ...args], { encoding: 'utf8', timeout: 30_000 });
  const discovered = run([]);
  assert.equal(discovered.status, 0, discovered.stdout + discovered.stderr);
  assert.match(discovered.stdout, /1 passed/);
  await fs.rename(defaultConfig, path.join(root, 'custom.config.mjs'));
  const explicit = run(['cases', '--config', 'custom.config.mjs']);
  assert.equal(explicit.status, 0, explicit.stdout + explicit.stderr);
  assert.match(explicit.stdout, /1 passed/);
});

test('test command uses bundled Vue plugin, jsdom, and V8 coverage in an external project', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runner-vue-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'node_modules'));
  // The target supplies its Vue runtime, without installing any test tooling.
  await fs.symlink(path.dirname(require.resolve('vue/package.json')), path.join(root, 'node_modules', 'vue'), 'dir');
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'Counter.vue'), `
<script setup lang="ts">
import { ref } from 'vue';
const count = ref<number>(0);
</script>
<template><button @click="count++">{{ count }}</button></template>
`);
  await fs.writeFile(path.join(root, 'src', 'Counter.test.ts'), `
import { test, expect } from 'vitest';
import { createApp, nextTick } from 'vue';
import Counter from './Counter.vue';
test('Vue component renders and reacts to DOM events', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(Counter);
  try {
    app.mount(host);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('0');
    button.click();
    await nextTick();
    expect(button.textContent).toBe('1');
  } finally { app.unmount(); host.remove(); }
});
`);
  await fs.writeFile(path.join(root, 'vitest.config.mjs'), `
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    coverage: {
      enabled: true, provider: 'v8', include: ['src/Counter.vue'],
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
`);
  const result = spawnSync(process.execPath, [cli, 'test', 'src', '--project', root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 passed/);
  const coverage = JSON.parse(await fs.readFile(path.join(root, 'coverage', 'coverage-final.json'), 'utf8'));
  const component = coverage[path.join(root, 'src', 'Counter.vue')];
  assert.ok(component, 'coverage must map back to the Vue source');
  assert.ok(Object.values(component.s).length > 0);
  assert.ok(Object.values(component.s).every(hits => hits > 0), 'all component statements must be covered');
  await fs.access(path.join(root, 'coverage', 'index.html'));
  assert.match(await fs.readFile(path.join(root, 'coverage', 'lcov.info'), 'utf8'), /SF:src\/Counter.vue/);
});
