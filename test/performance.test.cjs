const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { rspack, HotModuleReplacementPlugin, lazyCompilationMiddleware } = require('@rspack/core');
const { cacheDependencies, cacheVersion } = require('../src/cache.cjs');
const { adaptSass } = require('../src/sass-options.cjs');

const close = compiler => new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));

test('persistent cache version includes config contents, custom loaders and compiler options', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-cache-'));
  try {
    const file = path.join(dir, 'base.json');
    const customLoader = path.join(dir, 'loader.cjs');
    await fs.writeFile(file, '{"compilerOptions":{"target":"es2015"}}');
    await fs.writeFile(customLoader, 'module.exports = source => source;');
    await fs.writeFile(path.join(dir, 'babel.config.js'), 'module.exports = {};');
    const files = cacheDependencies(dir, 'development', new Set([file]), [{ use: [{ loader: customLoader }] }]);
    assert.ok(files.includes(file));
    assert.ok(files.includes(customLoader));
    assert.ok(files.includes(path.join(dir, 'babel.config.js')));
    const first = cacheVersion(files, { target: 2 }, 'development');
    await fs.writeFile(file, '{"compilerOptions":{"target":"es2022"}}');
    const second = cacheVersion(files, { target: 2 }, 'development');
    assert.notEqual(first, second);
    assert.notEqual(second, cacheVersion(files, { target: 9 }, 'development'));
    assert.notEqual(second, cacheVersion(files, { target: 2 }, 'test'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('embedded compiler preserves tilde aliases, SCSS variables and CSS additionalData', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-sass-'));
  let compiler;
  try {
    await fs.writeFile(path.join(dir, 'variables.scss'), '$color: #1890ff;');
    await fs.writeFile(path.join(dir, 'theme.css'), '.probe { color: $color; }');
    await fs.writeFile(path.join(dir, 'main.js'), "import css from './theme.css';globalThis.CSS_RESULT=css;");
    const use = adaptSass({ loader: '/project/sass-loader', options: { sassOptions: { outputStyle: 'expanded' }, additionalData: '@use "~@theme/variables.scss" as *;' } });
    compiler = rspack({ context: dir, mode: 'development', target: 'node', entry: './main.js', devtool: false,
      output: { path: path.join(dir, 'out'), filename: 'bundle.js' }, resolve: { alias: { '@theme': dir } },
      module: { rules: [{ test: /\.css$/, type: 'asset/source', use: [use] }] },
    });
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    const context = {};
    vm.runInNewContext(await fs.readFile(path.join(dir, 'out/bundle.js'), 'utf8'), context);
    assert.match(context.CSS_RESULT, /color: #1890ff/);
    assert.doesNotMatch(context.CSS_RESULT, /@use|\$color/);
    assert.ok(stats.compilation.fileDependencies.has(await fs.realpath(path.join(dir, 'variables.scss'))));
  } finally {
    if (compiler) await close(compiler);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('lazy middleware activates a deferred module and emits a hot update without a port', { timeout: 10000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-lazy-'));
  let compiler;
  try {
    await fs.writeFile(path.join(dir, 'main.js'), "globalThis.load = () => import('./page.js');");
    await fs.writeFile(path.join(dir, 'page.js'), "export const marker = 'LAZY_PAGE_READY';");
    compiler = rspack({ context: dir, mode: 'development', entry: './main.js', devtool: false,
      output: { path: path.join(dir, 'out'), filename: 'app.js' },
      cache: true, lazyCompilation: { entries: false, imports: true }, plugins: [new HotModuleReplacementPlugin()],
    });
    compiler.watchFileSystem = { watch() { return { close() {}, pause() {}, getInfo() { return { changes: new Set(), removals: new Set(), fileTimeInfoEntries: new Map(), contextTimeInfoEntries: new Map() }; } }; } };
    const middleware = lazyCompilationMiddleware(compiler);
    let resolveNext, rejectNext;
    const next = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Lazy compilation timed out')), 5000);
      resolveNext = value => { clearTimeout(timer); resolve(value); };
      rejectNext = error => { clearTimeout(timer); reject(error); };
    });
    const first = next();
    compiler.watch({}, (error, stats) => {
      if (error) return rejectNext(error);
      if (stats.hasErrors()) return rejectNext(new Error(stats.toString({ all: false, errors: true })));
      resolveNext(stats);
    });
    const initial = await first;
    const initialHash = initial.hash;
    const sources = initial.compilation.getAssets().map(asset => asset.source.source().toString()).join('\n');
    assert.doesNotMatch(sources, /LAZY_PAGE_READY/);
    const data = JSON.parse(sources.match(/var data = ("[^"]*lazy-compilation-proxy[^"\n]*");/)[1]);
    let passed = false;
    await middleware({ url: '/ordinary-route', method: 'GET' }, {}, () => { passed = true; });
    assert.equal(passed, true);
    const updated = next();
    let status;
    await middleware({ url: '/lazy-compilation-using-', method: 'POST', body: [data] }, {
      writeHead(code) { status = code; }, write() {}, end() {},
    }, () => assert.fail('lazy request must be handled'));
    assert.equal(status, 200);
    const second = await updated;
    const hot = second.compilation.getAssets().filter(asset => asset.name.endsWith('.hot-update.js'));
    assert.ok(hot.length);
    assert.match(hot.map(asset => asset.source.source().toString()).join('\n'), /module\.exports = __webpack_require__\.e/);
    assert.match(second.compilation.getAssets().map(asset => asset.source.source().toString()).join('\n'), /LAZY_PAGE_READY/);
    assert.notEqual(second.hash, initialHash);
  } finally {
    if (compiler) await close(compiler);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
