const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { rspack } = require('@rspack/core');
const { RspackDevServer } = require('@rspack/dev-server');
const { createConfig } = require('../src/adapter.cjs');
const WebSocket = createRequire(require.resolve('@rspack/dev-server'))('ws');
const { chromium } = require('playwright');

function nextCompilation(compiler, previousHash) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Compilation timed out')), 60000);
    compiler.hooks.done.tap('smoke', stats => {
      if (previousHash && stats.hash === previousHash) return;
      clearTimeout(timer);
      if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve(stats);
    });
  });
}

async function main() {
  const project = path.resolve(process.argv[2] || '../assets-supervision-ui');
  const fixture = await fs.mkdtemp(path.resolve(__dirname, '../.cache/smoke-'));
  let server, socket, backend, browser;
  try {
    const svg = path.join(project, 'src/icon/svg/account.svg');
    const entry = path.join(fixture, 'main.ts');
    const vue = path.join(fixture, 'App.vue');
    await fs.writeFile(path.join(fixture, 'Lazy.vue'), '<script setup lang="ts">const label: string = "LAZY_LOADED";</script><template><strong class="lazy-probe">{{label}}</strong></template><style lang="scss">.lazy-probe {color: $base-color-primary;}</style>');
    await fs.writeFile(entry, "import { createApp } from 'vue'; import App from './App.vue'; createApp(App).mount('#app');");
    const makeVue = marker => `<script setup lang="ts">import icon from ${JSON.stringify(svg)}; import {createApp} from 'vue'; const count = ref<number>(1); const load = async () => createApp((await import('./Lazy.vue')).default).mount('#lazy-target');</script><template><el-button @click="load">{{ count }} ${marker}</el-button><svg><use :href="'#' + icon.id" /></svg><div id="lazy-target"></div></template><style lang="scss">.smoke { color: $base-color-primary; }</style>`;
    await fs.writeFile(vue, makeVue('RUNNER_BEFORE'));
    backend = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ path: req.url, ok: true })); });
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    const { config, devServer } = await createConfig({ project });
    config.lazyCompilation.test = /[\\/]Lazy\.vue$/;
    config.entry = { app: entry };
    config.optimization.splitChunks = false;
    devServer.host = '127.0.0.1';
    devServer.port = 0;
    devServer.proxy = [{ context: ['/__runner_probe'], target: `http://127.0.0.1:${backend.address().port}`, pathRewrite: { '^/__runner_probe': '' } }];
    const compiler = rspack(config);
    const initial = nextCompilation(compiler);
    server = new RspackDevServer(devServer, compiler);
    await server.start();
    const first = await initial;
    const firstHash = first.hash;
    const base = `http://127.0.0.1:${server.server.address().port}`;
    const html = await fetch(base).then(r => r.text());
    assert.match(html, /<div id="app">/);
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    const appScript = scripts.find(src => src.includes('/app.js'));
    assert.ok(appScript, 'HTML injects app bundle');
    const bundle = await fetch(new URL(appScript, base)).then(r => r.text());
    assert.match(bundle, /RUNNER_BEFORE/);
    assert.match(bundle, /icon-account/);
    assert.match(bundle, /element-plus/);
    const proxy = await fetch(`${base}/__runner_probe/check?x=1`).then(r => r.json());
    assert.deepEqual(proxy, { path: '/check?x=1', ok: true });
    assert.equal((await fetch(`${base}/tinymce/tinymce.min.js`)).status, 200);
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base);
    await page.getByRole('button', { name: /RUNNER_BEFORE/ }).click();
    await page.getByText('LAZY_LOADED', { exact: true }).waitFor();
    const messages = [];
    socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: base });
    socket.on('message', data => messages.push(JSON.parse(String(data))));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const update = nextCompilation(compiler, firstHash);
    await fs.writeFile(vue, makeVue('RUNNER_AFTER'));
    const second = await update;
    assert.notEqual(second.hash, firstHash);
    const assets = second.compilation.getAssets();
    const hotAssets = assets.filter(asset => asset.name.endsWith('.hot-update.js'));
    assert.ok(hotAssets.length, 'hot-update JavaScript emitted');
    const hot = (await Promise.all(hotAssets.map(asset => fetch(`${base}/${asset.name}`).then(r => r.text())))).join('\n');
    assert.match(hot, /RUNNER_AFTER/);
    const deadline = Date.now() + 5000;
    while (!messages.some(m => m.type === 'hash' && m.data === second.hash) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(messages.some(m => m.type === 'hash' && m.data === second.hash), `HMR hash sent over WebSocket: ${JSON.stringify(messages)}`);
    await page.getByRole('button', { name: /RUNNER_AFTER/ }).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS: Vue + tsrs + embedded Sass + auto imports + Element Plus + SVG, HTML/static, proxy rewrite, lazy page activation, HMR WebSocket and browser DOM update');
  } finally {
    socket?.terminate();
    if (browser) await browser.close();
    if (server) await server.stop();
    if (server) await new Promise((resolve, reject) => server.compiler.close(error => error ? reject(error) : resolve()));
    if (backend) await new Promise(resolve => backend.close(resolve));
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

fs.mkdir(path.resolve(__dirname, '../.cache'), { recursive: true })
  .then(main).catch(error => { console.error(error); process.exitCode = 1; });
