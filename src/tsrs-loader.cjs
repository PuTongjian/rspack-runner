const { SourceMapConsumer, SourceMapGenerator } = require('source-map');

const sessions = new WeakMap();
const sdk = import('tsrs/unstable/async');
const ast = import('tsrs/unstable/ast');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

async function getSession(compiler, context) {
  if (!sessions.has(compiler)) {
    const session = sdk.then(({ API }) => new API({ cwd: context }));
    sessions.set(compiler, session);
    compiler.hooks.shutdown.tapPromise('tsrs-loader', async () => {
      try { await (await session).close(); }
      finally { sessions.delete(compiler); }
    });
  }
  return sessions.get(compiler);
}

// Rspack owns module resolution; only carry options that affect single-file emit.
async function readCompilerOptions(project, configFile, dependencies = new Set()) {
  const [{ API, ModuleKind, JsxEmit }, { ScriptTarget }] = await Promise.all([sdk, ast]);
  const api = new API({ cwd: project });
  try {
    const collect = async file => {
      if (dependencies.has(file)) return;
      dependencies.add(file);
      const { config, error } = await api.readConfigFile(file);
      if (error) throw new Error(error.text);
      for (const base of [config.extends || []].flat()) {
        const req = createRequire(file);
        let resolved;
        for (const candidate of [base, `${base}.json`, `${base}/tsconfig.json`]) {
          try { resolved = req.resolve(candidate); break; } catch {}
        }
        if (!resolved && path.isAbsolute(base) && fs.existsSync(base)) resolved = base;
        if (!resolved) throw new Error(`Cannot resolve tsconfig extends ${base} from ${file}`);
        await collect(resolved);
      }
    };
    await collect(configFile);
    const parsed = await api.parseConfigFile(configFile);
    const errors = (parsed.errors || []).filter(error => error.code !== 5023 || !error.text.includes("'suppressImplicitAnyIndexErrors'"));
    if (errors.length) throw new Error(errors.map(error => `${error.fileName}: TS${error.code}: ${error.text}`).join('\n'));
    const options = {};
    for (const name of ['target', 'jsx', 'jsxFactory', 'jsxFragmentFactory', 'jsxImportSource', 'importHelpers', 'useDefineForClassFields', 'experimentalDecorators', 'emitDecoratorMetadata', 'removeComments', 'verbatimModuleSyntax', 'esModuleInterop', 'alwaysStrict', 'preserveConstEnums']) {
      if (parsed.options[name] !== undefined) options[name] = parsed.options[name];
    }
    options.target = Math.max(options.target ?? ScriptTarget.ES2015, ScriptTarget.ES2015);
    options.module = ModuleKind.ESNext;
    options.jsx ??= JsxEmit.Preserve;
    return options;
  } finally { await api.close(); }
}

module.exports = function (source, inputSourceMap) {
  const done = this.async();
  (async () => {
    const { compilerOptions, configFile, configFiles = [], tsx } = this.getOptions();
    if (configFile) this.addDependency(configFile);
    for (const file of configFiles) this.addDependency(file);
    const api = await getSession(this._compiler, this.rootContext);
    const fileName = this.resourcePath.endsWith('.vue') ? `${this.resourcePath}.${tsx ? 'tsx' : 'ts'}` : this.resourcePath;
    const result = await api.transpileModule(source, {
      fileName, reportDiagnostics: true,
      compilerOptions: { ...compilerOptions, sourceMap: this.sourceMap, inlineSources: this.sourceMap },
    });
    for (const diagnostic of result.diagnostics || []) {
      const pos = diagnostic.startPosition;
      const error = new Error(`${diagnostic.fileName || fileName}${pos ? `:${pos.line + 1}:${pos.character + 1}` : ''} TS${diagnostic.code}: ${diagnostic.text}`);
      if (diagnostic.category === 1) this.emitError(error);
      else this.emitWarning(error);
    }
    let map = result.sourceMapText ? JSON.parse(result.sourceMapText) : undefined;
    if (map && inputSourceMap) {
      const generated = new SourceMapConsumer(map);
      const original = new SourceMapConsumer(inputSourceMap);
      const merged = SourceMapGenerator.fromSourceMap(generated);
      merged.applySourceMap(original, map.sources[0]);
      map = merged.toJSON();
    }
    done(null, result.outputText, map);
  })().catch(done);
};

module.exports.readCompilerOptions = readCompilerOptions;
