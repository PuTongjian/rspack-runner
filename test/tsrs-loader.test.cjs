const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { rspack } = require('@rspack/core');
const { SourceMapConsumer, SourceMapGenerator } = require('source-map');
const loader = require('../src/tsrs-loader.cjs');

test('tsrs erases types, compiles enums, maps to original source and reports syntax errors', async () => {
  let shutdown;
  const compiler = { hooks: { shutdown: { tapPromise(name, fn) { shutdown = fn; } } } };
  const transpile = (source, inputMap, tsx = false) => new Promise((resolve, reject) => {
    const errors = [];
    loader.call({
      _compiler: compiler, rootContext: process.cwd(), resourcePath: '/fixture/Probe.vue', sourceMap: true,
      getOptions: () => ({ compilerOptions: { target: 9, module: 99, jsx: 1 }, tsx }),
      addDependency() {}, emitError(error) { errors.push(error); }, emitWarning() {},
      async: () => (error, output, map) => error ? reject(error) : resolve({ output, map, errors }),
    }, source, inputMap);
  });
  try {
    const source = 'enum State { Ready = 7 }; const answer: number = State.Ready; globalThis.answer = answer;';
    const inputMap = new SourceMapGenerator({ file: 'Probe.vue.ts' });
    inputMap.addMapping({ generated: { line: 1, column: 0 }, original: { line: 9, column: 0 }, source: 'Original.vue' });
    inputMap.setSourceContent('Original.vue', '\n'.repeat(8) + source);
    const result = await transpile(source, inputMap.toJSON());
    assert.equal(result.errors.length, 0);
    assert.doesNotMatch(result.output, /: number/);
    const context = {};
    vm.runInNewContext(result.output, context);
    assert.equal(context.answer, 7);
    const map = new SourceMapConsumer(result.map);
    const positions = [];
    map.eachMapping(mapping => positions.push(mapping.originalLine));
    assert.ok(positions.includes(9));
    assert.ok(result.map.sources.includes('Original.vue'));
    const tsx = await transpile('const view: any = <button>TSX</button>;', undefined, true);
    assert.equal(tsx.errors.length, 0);
    assert.match(tsx.output, /<button>TSX<\/button>/);
    const broken = await transpile('const broken: = ;');
    assert.ok(broken.errors.some(error => /TS\d+/.test(error.message)));
  } finally { await shutdown(); }
});

test('legacy config options are adapted without project TypeScript and Rspack uses tsrs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-tsrs-'));
  let compiler;
  try {
    const configFile = path.join(dir, 'tsconfig.json');
    await fs.writeFile(path.join(dir, 'base.json'), JSON.stringify({ compilerOptions: { target: 'es5', jsx: 'preserve', useDefineForClassFields: true } }));
    await fs.writeFile(configFile, JSON.stringify({ extends: './base.json', compilerOptions: { suppressImplicitAnyIndexErrors: true, downlevelIteration: true }, include: ['main.ts'] }));
    await fs.writeFile(path.join(dir, 'main.ts'), 'enum State { Ready = 42 }; globalThis.TSRS_RESULT = State.Ready;');
    const dependencies = new Set();
    const compilerOptions = await loader.readCompilerOptions(dir, configFile, dependencies);
    assert.ok(dependencies.has(await fs.realpath(path.join(dir, 'base.json'))));
    assert.equal(compilerOptions.target, 2);
    assert.equal(compilerOptions.useDefineForClassFields, true);
    assert.equal(compilerOptions.module, 99);
    assert.equal(compilerOptions.downlevelIteration, undefined);
    compiler = rspack({
      context: dir, mode: 'development', target: 'node', entry: './main.ts', devtool: 'source-map',
      output: { path: path.join(dir, 'out'), filename: 'bundle.cjs' },
      module: { rules: [{ test: /\.ts$/, use: [{ loader: require.resolve('../src/tsrs-loader.cjs'), options: { compilerOptions, configFile } }] }] },
      optimization: { minimize: false },
    });
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    const context = {};
    vm.runInNewContext(await fs.readFile(path.join(dir, 'out/bundle.cjs'), 'utf8'), context);
    assert.equal(context.TSRS_RESULT, 42);
    assert.ok(stats.compilation.fileDependencies.has(configFile));
    const map = JSON.parse(await fs.readFile(path.join(dir, 'out/bundle.cjs.map'), 'utf8'));
    assert.ok(map.sources.some(source => source.endsWith('main.ts')));
    await fs.writeFile(configFile, '{"compilerOptions":{"unknownRunnerOption":true}}');
    await assert.rejects(loader.readCompilerOptions(dir, configFile), /unknownRunnerOption/);
  } finally {
    if (compiler) await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
