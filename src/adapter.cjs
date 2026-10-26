const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const rspack = require('@rspack/core');
const HtmlPlugin = require('html-webpack-plugin');
const { readCompilerOptions } = require('./tsrs-loader.cjs');
const { adaptSass } = require('./sass-options.cjs');
const { cacheDependencies, cacheVersion } = require('./cache.cjs');

const VUE_RUNTIME_COMPAT_VERSION = 3;

// Vue 3.5's renderSlot assumes that a rendering instance is always present.
// Rspack's lazy/HMR slot path can invoke it without one, which otherwise
// surfaces as "Cannot read properties of null (reading 'ce')" in the browser.
function patchVueRuntimeNullGuard(source) {
  const expression = 'currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce';
  const replacement = 'currentRenderingInstance && (currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce)';
  return source.includes(expression) ? source.replace(expression, replacement) : source;
}

class VueRuntimeCompatPlugin {
  apply(compiler) {
    compiler.hooks.emit.tap('VueRuntimeCompatPlugin', compilation => {
      const { sources } = compiler.webpack;
      for (const [name, asset] of Object.entries(compilation.assets)) {
        const source = asset.source().toString();
        const patched = patchVueRuntimeNullGuard(source);
        if (patched !== source) compilation.assets[name] = new sources.RawSource(patched);
      }
    });
  }
}

function normalizeProxy(proxy) {
  if (!proxy || Array.isArray(proxy)) return proxy;
  if (typeof proxy !== 'object') throw new Error('This demo supports object/array devServer.proxy only.');
  return Object.entries(proxy).map(([context, value]) => ({
    ...(typeof value === 'string' ? { target: value } : value), context: [context],
  }));
}

// Intercept only the known unplugin factory modules while Vue CLI evaluates config.
// The hooks are restored before compilation; project files and exports stay untouched.
async function loadService(project, mode) {
  const projectRequire = createRequire(path.join(project, 'package.json'));
  const cliVersion = projectRequire('@vue/cli-service/package.json').version;
  if (!cliVersion.startsWith('5.') || !projectRequire('vue/package.json').version.startsWith('3.')) {
    throw new Error('This demo supports Vue CLI 5 + Vue 3 only.');
  }
  const replacements = new Map();
  const unwrap = value => value.default || value;
  for (const name of ['unplugin-auto-import', 'unplugin-vue-components', 'unplugin-vue-define-options', 'unplugin-element-plus']) {
    let filename;
    try { filename = projectRequire.resolve(`${name}/webpack`); }
    catch (error) { if (error.code === 'MODULE_NOT_FOUND') continue; throw error; }
    const plugin = unwrap(projectRequire(name));
    let factory = plugin.rspack;
    if (!factory && plugin.raw) {
      const unpluginRequire = createRequire(projectRequire.resolve('unplugin-auto-import'));
      factory = unpluginRequire('unplugin').createRspackPlugin(plugin.raw);
    }
    if (!factory) throw new Error(`Cannot adapt ${name}: no Rspack factory available.`);
    const wrapper = options => {
      if (name === 'unplugin-auto-import' || name === 'unplugin-vue-components') {
        options = { ...options, dts: false, ...(name === 'unplugin-auto-import' ? { eslintrc: { enabled: false } } : {}) };
      }
      return factory(options);
    };
    wrapper.default = wrapper;
    replacements.set(filename, wrapper);
  }
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request.endsWith('/webpack')) {
      const filename = Module._resolveFilename(request, parent);
      if (replacements.has(filename)) return replacements.get(filename);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const Service = projectRequire('@vue/cli-service/lib/Service');
    const service = new Service(project);
    await service.init(mode);
    return { service, config: service.resolveWebpackConfig(), projectRequire };
  } finally { Module._load = originalLoad; }
}

function adaptRules(rules, cacheDir, typescript = {}, embeddedSass = true) {
  for (const rule of rules) {
    for (const key of ['rules', 'oneOf']) if (rule[key]) adaptRules(rule[key], cacheDir, typescript, embeddedSass);
    if (!Array.isArray(rule.use)) continue;
    rule.use = rule.use.map(use => {
      if (typeof use !== 'object') return use;
      if (use.loader.includes('ts-loader')) return { ...use, loader: require.resolve('./tsrs-loader.cjs'), options: { ...typescript, tsx: Boolean(use.options?.appendTsxSuffixTo) || Boolean(rule.test?.test('module.tsx')) } };
      if (use.loader.includes('mini-css-extract-plugin')) return { ...use, loader: rspack.CssExtractRspackPlugin.loader };
      if (use.loader.includes('svg-sprite-loader')) return { ...use, loader: require.resolve('./svg-sprite-loader.cjs'), options: { ...use.options, originalLoader: use.loader } };
      if (use.loader.includes('babel-loader')) return { ...use, options: { ...use.options, cacheCompression: false, cacheDirectory: path.join(cacheDir, 'babel-uncompressed') } };
      if (embeddedSass && use.loader.includes('sass-loader')) return adaptSass(use);
      return use;
    });
  }
}

async function createConfig({ project, mode = 'development', port, host = 'localhost', lazy = true, persistent = true, embeddedSass = true, devtool = 'eval-cheap-module-source-map' }) {
  process.chdir(project);
  process.env.NODE_ENV = 'development';
  process.env.VUE_CLI_BUILD_TARGET = 'app';
  const { service, config, projectRequire } = await loadService(project, mode);
  // Resolve the same vue-loader copy that Vue CLI uses, including pnpm layouts.
  const cliConfigRequire = createRequire(projectRequire.resolve('@vue/cli-service/lib/config/base.js'));
  const { VueLoaderPlugin } = cliConfigRequire('vue-loader');
  const options = service.projectOptions;
  const cacheDir = path.resolve(__dirname, '../.cache', createHash('sha256').update(project).digest('hex').slice(0, 12));
  const tsconfig = path.join(project, 'tsconfig.json');
  const configFiles = new Set();
  const compilerOptions = await readCompilerOptions(project, tsconfig, configFiles);
  const notices = [`TypeScript transpiler: tsrs ${require('tsrs').version} (project ts-loader replaced).`];
  config.plugins = config.plugins.flatMap(plugin => {
    if (!plugin) return [];
    const name = plugin.constructor.name;
    if (name === 'DefinePlugin' || name === 'ProvidePlugin') return [new rspack[name](plugin.definitions)];
    if (name === 'BannerPlugin') return [new rspack.BannerPlugin(plugin.options)];
    if (name === 'MiniCssExtractPlugin') return [new rspack.CssExtractRspackPlugin(plugin.options)];
    if (name === 'HtmlWebpackPlugin') return [new HtmlPlugin(plugin.userOptions)];
    if (name === 'CopyPlugin') {
      notices.push('Public assets are served by devServer.static (CopyPlugin omitted in dev).');
      return [];
    }
    if (['FriendlyErrorsWebpackPlugin', 'CaseSensitivePathsPlugin', 'WebpackBarProgressPlugin', 'ForkTsCheckerWebpackPlugin'].includes(name)) {
      notices.push(`${name} omitted in this demo.${name === 'ForkTsCheckerWebpackPlugin' ? ' Run TypeScript checking separately.' : ''}`);
      return [];
    }
    // VueLoaderPlugin and the captured native unplugin instances are retained.
    if (plugin instanceof VueLoaderPlugin || name === 'Object') return [plugin];
    throw new Error(`Unsupported plugin ${name}; add an explicit adapter instead of silently dropping it.`);
  });
  adaptRules(config.module.rules, cacheDir, { compilerOptions, configFile: tsconfig, configFiles: [...configFiles] }, embeddedSass);
  config.module.rules.unshift({
    test: /[\\/]@vue[\\/]runtime-core[\\/].*\.js$/,
    enforce: 'post',
    use: [require.resolve('./vue-runtime-compat-loader.cjs')],
  });
  delete config.optimization.minimizer; // Development compilation does not minify.
  config.mode = 'development';
  config.output.path = path.join(cacheDir, 'dist');
  config.cache = true;
  const buildDependencies = cacheDependencies(project, mode, configFiles, config.module.rules);
  config.experiments = {
    ...config.experiments,
    cache: persistent ? {
      type: 'persistent', buildDependencies,
      version: cacheVersion(buildDependencies, { compilerOptions, lazy, embeddedSass, devtool, vueRuntimeCompat: VUE_RUNTIME_COMPAT_VERSION }, mode),
      storage: { type: 'filesystem', directory: path.join(cacheDir, 'rspack') },
    } : { type: 'memory' },
  };
  config.devtool = devtool;
  config.plugins.push(new VueRuntimeCompatPlugin());
  config.lazyCompilation = lazy ? { entries: false, imports: true, test: /[\\/](?:src[\\/]views|agilebpm[\\/]package)[\\/].*\.vue$/ } : false;
  notices.push(`Cache: ${persistent ? 'persistent + memory' : 'memory'}; lazy Vue pages: ${lazy ? 'on' : 'off'}; Sass: ${embeddedSass ? 'embedded modern compiler' : 'project loader'}.`);
  config.stats = { preset: 'errors-warnings', warnings: false, children: true };
  config.infrastructureLogging = { level: 'warn' };
  const dev = options.devServer || {};
  const devServer = {
    ...dev,
    host,
    port: port || dev.port || 8080,
    open: false,
    hot: true,
    historyApiFallback: { disableDotRule: true, index: options.publicPath || '/', ...dev.historyApiFallback },
    static: { directory: path.join(project, 'public'), publicPath: options.publicPath || '/', ...dev.static },
    proxy: normalizeProxy(dev.proxy),
    devMiddleware: { ...dev.devMiddleware, writeToDisk: false },
    setupMiddlewares(middlewares, server) {
      if (config.lazyCompilation) middlewares.unshift({ name: 'rspack-lazy-compilation', middleware: rspack.lazyCompilationMiddleware(server.compiler) });
      service.devServerConfigFns.forEach(fn => fn(server.app, server));
      return dev.setupMiddlewares ? dev.setupMiddlewares(middlewares, server) : middlewares;
    },
  };
  return { config, devServer, notices };
}

module.exports = { createConfig, normalizeProxy, adaptRules };
