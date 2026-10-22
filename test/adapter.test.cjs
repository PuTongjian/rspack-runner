const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProxy, adaptRules } = require('../src/adapter.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('proxy conversion preserves rewrite, websocket and headers', () => {
  const rewrite = { '^/api': '/' };
  const result = normalizeProxy({ '/api': { target: 'http://localhost:9000', ws: true, changeOrigin: true, pathRewrite: rewrite }, '/es': 'http://localhost:9001' });
  assert.deepEqual(result, [
    { context: ['/api'], target: 'http://localhost:9000', ws: true, changeOrigin: true, pathRewrite: rewrite },
    { context: ['/es'], target: 'http://localhost:9001' },
  ]);
  assert.equal(normalizeProxy(result), result);
  assert.equal(normalizeProxy(undefined), undefined);
  assert.throws(() => normalizeProxy('http://localhost:9000'), /object\/array/);
});

test('nested loader rules keep options and move only Babel caches', () => {
  const options = { additionalData: () => 'original' };
  const rules = [{ oneOf: [{ use: [
    { loader: '/project/node_modules/babel-loader/lib/index.js', options: { cacheDirectory: '/project/cache', presets: ['original'] } },
    { loader: '/project/node_modules/sass-loader/dist/cjs.js', options },
    { loader: 'svg-sprite-loader', options: { symbolId: 'icon-[name]' } },
    { loader: '/project/node_modules/mini-css-extract-plugin/dist/loader.js', options: { publicPath: '/' } },
  ] }] }];
  adaptRules(rules, '/runner/cache');
  const use = rules[0].oneOf[0].use;
  assert.equal(use[0].options.cacheDirectory, '/runner/cache/babel-uncompressed');
  assert.equal(use[0].options.cacheCompression, false);
  assert.deepEqual(use[0].options.presets, ['original']);
  assert.equal(use[1].options.additionalData, options.additionalData);
  assert.equal(use[1].options.api, 'modern-compiler');
  assert.match(use[1].options.implementation, /sass-embedded/);
  assert.match(use[2].loader, /svg-sprite-loader.cjs$/);
  assert.equal(use[2].options.symbolId, 'icon-[name]');
  assert.equal(use[2].options.originalLoader, 'svg-sprite-loader');
  assert.equal(use[3].options.publicPath, '/');
  assert.match(use[3].loader, /rspack/);
});

test('CLI rejects invalid ports and commands before loading a project', () => {
  for (const args of [['dev', '--port', 'abc'], ['dev', '--port', '0'], ['build']]) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../src/cli.cjs'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /port must be|Only the dev/);
  }
});

test('TypeScript and Vue TSX rules use the runner tsrs loader', () => {
  const rules = [{ oneOf: [
    { test: /\.ts$/, use: [{ loader: '/project/ts-loader/index.js', options: { appendTsSuffixTo: ['\\.vue$'] } }] },
    { test: /\.tsx$/, use: [{ loader: '/project/ts-loader/index.js', options: { appendTsxSuffixTo: ['\\.vue$'] } }] },
  ] }];
  const typescript = { configFile: '/project/tsconfig.json', compilerOptions: { target: 2, module: 99 } };
  adaptRules(rules, '/runner/cache', typescript);
  for (const [index, rule] of rules[0].oneOf.entries()) {
    assert.match(rule.use[0].loader, /tsrs-loader\.cjs$/);
    assert.deepEqual(rule.use[0].options, { ...typescript, tsx: index === 1 });
  }
});
