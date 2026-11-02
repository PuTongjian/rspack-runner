const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { gunzipSync } = require('node:zlib');
const { parse } = require('flatted');

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

async function availablePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitUntil(check, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${description}`);
}

test('test --ui serves the authenticated live UI, reruns changes, and closes on SIGTERM', { timeout: 30_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-live-ui-'));
  const port = await availablePort();
  const file = path.join(root, 'visual.test.mjs');
  await fs.writeFile(file, "import { test, expect } from 'vitest'; test('visual result', () => expect(2 + 3).toBe(5));");
  const child = spawn(process.execPath, [cli, 'test', '--project', root, '--ui', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode == null) child.kill('SIGKILL');
    await fs.rm(root, { recursive: true, force: true });
  });
  const uiURL = await waitUntil(() => output.match(/http:\/\/127\.0\.0\.1:\d+\/__vitest__\/\?token=[^\s\u001b]+/)?.[0], 'token-protected Vitest UI URL');
  const bootstrap = await fetch(uiURL, { redirect: 'manual' });
  assert.equal(bootstrap.status, 302, output);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const response = await fetch(new URL('/__vitest__/', uiURL), { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, output);
  assert.match(await response.text(), /vitest|Vitest/);
  await waitUntil(() => /1 passed/.test(output), 'initial UI run');
  assert.equal(child.exitCode, null, 'UI must remain alive after tests complete');
  await fs.writeFile(file, "import { test, expect } from 'vitest'; test('updated visual result', () => expect(2 + 3).toBe(9));");
  await waitUntil(() => /updated visual result/.test(output) && /1 failed/.test(output), 'watch-mode rerun');
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
  await assert.rejects(fetch(uiURL), /fetch failed/);
});

test('test command bundles browser provider and portable HTML reports with trace view', { timeout: 30_000 }, async t => {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { await fs.access(executablePath); }
  catch { t.skip('Set PLAYWRIGHT_EXECUTABLE_PATH to run the real-browser trace integration'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-browser-trace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'trace.test.mjs'), `
import { test, expect } from 'vitest';
import { page } from 'vitest/browser';
test('browser actions are replayable', async () => {
  document.body.innerHTML = '<label>Name<input aria-label="Name" /></label><button>Save</button><output></output>';
  document.querySelector('button').onclick = () => { document.querySelector('output').textContent = document.querySelector('input').value; };
  await page.mark('trace fixture rendered');
  await page.getByRole('textbox', { name: 'Name' }).fill('Trace result');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.element(page.getByText('Trace result', { exact: true })).toBeVisible();
});
`);
  await fs.writeFile(path.join(root, 'vitest.config.mjs'), `
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
export default defineConfig({ test: {
  reporters: ['default', ['html', { outputDir: 'report', singleFile: true }]],
  browser: { enabled: true, headless: true, provider: playwright({ launchOptions: { executablePath: ${JSON.stringify(executablePath)} } }), instances: [{ browser: 'chromium' }], traceView: true },
} });
`);
  const result = spawnSync(process.execPath, [cli, 'test', '--project', root], { encoding: 'utf8', timeout: 25_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /1 passed/);
  const html = await fs.readFile(path.join(root, 'report', 'index.html'), 'utf8');
  assert.match(html, /Vitest/);
  assert.match(html, /window.HTML_REPORT_METADATA/);
  const encoded = html.match(/\("(H4sI[A-Za-z0-9+/=]+)"\)/)?.[1];
  assert.ok(encoded, 'the single-file report must contain compressed test metadata');
  const metadata = parse(gunzipSync(Buffer.from(encoded, 'base64')).toString());
  assert.equal(metadata.files[0].tasks[0].name, 'browser actions are replayable');
  const traces = metadata.files[0].tasks[0].artifacts.filter(artifact => artifact.type === 'internal:browserTrace');
  assert.ok(traces.length > 0, 'the report must preserve built-in trace view artifacts');
  assert.ok(traces.some(trace => trace.data.entries.some(entry => entry.name?.includes('trace fixture rendered'))));
  assert.ok(html.length > 100_000, 'UI and trace resources must be inlined into the report');
});

test('UI CLI options validate port and command usage', () => {
  for (const args of [['test', '--ui', '--port', '0'], ['test', '--port', '51204'], ['run', '--ui']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /port must be|requires --ui|only supported by the test/);
  }
});
