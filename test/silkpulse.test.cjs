const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rspack } = require('@rspack/core');
const HtmlPlugin = require('html-webpack-plugin');
const { JSDOM } = require('jsdom');
const { resolveSilkpulseServer, SilkPulsePlugin } = require('../src/silkpulse.cjs');

test('SilkPulse is opt-in and requires an explicit HTTP(S) server', () => {
  assert.equal(resolveSilkpulseServer(false, undefined), undefined);
  assert.equal(resolveSilkpulseServer(true, 'http://192.168.1.150:18082/'), 'http://192.168.1.150:18082');
  assert.equal(resolveSilkpulseServer(true, 'https://debug.example.com/proxy/'), 'https://debug.example.com/proxy');
  assert.throws(() => resolveSilkpulseServer(true, undefined), /requires --silkpulse-server/);
  assert.throws(() => resolveSilkpulseServer(false, 'http://localhost:8080'), /requires --silkpulse/);
  assert.throws(() => resolveSilkpulseServer(true, 'http://localhost:8080', 'build'), /only supported by run\/dev/);
  for (const server of ['not-a-url', '//localhost:8080', 'javascript:alert(1)', 'ftp://localhost', 'http://user:pass@localhost', 'http://localhost/?token=secret', 'http://localhost/#fragment']) {
    assert.throws(() => resolveSilkpulseServer(true, server), /HTTP\(S\).*credentials, query, or fragment/);
  }
});

test('CLI reports SilkPulse option mistakes before loading a project', () => {
  const cli = path.resolve(__dirname, '../src/cli.cjs');
  const cases = [
    [['run', '--silkpulse'], /requires --silkpulse-server/],
    [['run', '--silkpulse-server', 'http://localhost:8080'], /requires --silkpulse/],
    [['run', '--silkpulse', '--silkpulse-server', 'javascript:alert(1)'], /HTTP\(S\)/],
    [['build', '--silkpulse', '--silkpulse-server', 'http://localhost:8080'], /only supported by run\/dev/],
    [['test', '--silkpulse', '--silkpulse-server', 'http://localhost:8080'], /only supported by run\/dev/],
  ];
  for (const [args, message] of cases) {
    const result = spawnSync(process.execPath, [cli, ...args, '--project', '/missing-project'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /Cannot find module/);
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--silkpulse.*--silkpulse-server/);
});

test('real Rspack HTML output injects a synchronous SDK before application bundles and preserves URL attributes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-silkpulse-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'main.js'), 'globalThis.APPLICATION_READY = true;');
  const server = 'https://debug.example.com/proxy&copy;';
  for (const enabled of [true, false]) {
    const out = path.join(root, enabled ? 'enabled' : 'disabled');
    const compiler = rspack({ context: root, mode: 'development', entry: './main.js', devtool: false,
      output: { path: out, filename: 'app.js' },
      plugins: [new HtmlPlugin({ title: 'SilkPulse test', scriptLoading: 'defer' }), ...(enabled ? [new SilkPulsePlugin(server)] : [])],
    });
    try {
      const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
      assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
      const dom = new JSDOM(await fs.readFile(path.join(out, 'index.html'), 'utf8'));
      const scripts = [...dom.window.document.querySelectorAll('script')];
      if (enabled) {
        assert.equal(scripts.length, 2);
        assert.equal(scripts[0].getAttribute('src'), server + '/sdk.js');
        assert.equal(scripts[0].getAttribute('data-server'), server);
        assert.equal(scripts[0].getAttribute('crossorigin'), 'anonymous');
        assert.equal(scripts[0].getAttribute('data-floating-ball'), '0');
        assert.equal(scripts[0].hasAttribute('async'), false);
        assert.equal(scripts[0].hasAttribute('defer'), false);
      } else {
        assert.equal(scripts.length, 1);
        assert.equal(dom.window.document.querySelector('script[data-server]'), null);
      }
      assert.equal(scripts.at(-1).getAttribute('src'), 'app.js');
      dom.window.close();
    } finally {
      await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    }
  }
});
