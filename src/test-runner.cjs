const fs = require('node:fs/promises');
const path = require('node:path');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

function resolveBundledBrowserIncludes(environment) {
  if (!environment?.optimizeDeps?.include) return;
  environment.optimizeDeps.include = environment.optimizeDeps.include.map(id => {
    if (id === 'vitest') return path.join(path.dirname(require.resolve('vitest/package.json')), 'dist/index.js');
    if (id.startsWith('vitest > ')) return require.resolve(id.slice('vitest > '.length));
    if (id.startsWith('vitest/internal/')) return require.resolve(id);
    return id;
  });
}

async function runTests({ project, directory, config, ui = false, port = 51204, host = '127.0.0.1' }) {
  const root = await fs.realpath(path.resolve(project || process.cwd()));
  const dir = await fs.realpath(path.resolve(root, directory || '.'));
  if (!(await fs.stat(dir)).isDirectory()) throw new Error(`Test directory is not a directory: ${dir}`);
  const relative = path.relative(root, dir);
  const { startVitest } = await import('vitest/node');
  // Config files outside the runner can use its bundled configuration helpers.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context); }
      catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND' || !['vitest/config', 'vite', '@vitejs/plugin-vue', '@vitest/browser-playwright'].includes(specifier)) throw error;
        return nextResolve(pathToFileURL(require.resolve(specifier)).href, context);
      }
    },
  });
  let ctx;
  try {
    ctx = await startVitest('test', directory ? [dir.split(path.sep).join('/') + '/'] : [], {
      root, run: !ui, watch: ui, configLoader: 'native',
      ...(ui ? { ui: true, open: false, api: { host, port, strictPort: true } } : {}),
      ...(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? { dir } : {}),
      ...(config === undefined ? {} : { config: path.resolve(root, config) }),
    }, {
      plugins: [{
        name: 'rspack-runner:bundled-test-tools', enforce: 'pre',
        config() {
          return {
            resolve: { alias: [
              { find: /^vitest$/, replacement: path.join(path.dirname(require.resolve('vitest/package.json')), 'dist/index.js') },
              { find: 'vitest/internal/browser', replacement: require.resolve('vitest/internal/browser') },
              { find: 'vitest/internal/traces', replacement: require.resolve('vitest/internal/traces') },
            ] },
          };
        },
        configEnvironment(name, environment) {
          if (name !== 'client') return;
          // Nested optimizer includes resolve from the target root, which has
          // no Vitest install. Use the same bundled module paths as the aliases.
          resolveBundledBrowserIncludes(environment);
        },
        async resolveId(id, importer) {
          if (id !== 'vitest' && !id.startsWith('vitest/') && id !== '@vitest/ui/reporter') return;
          return await this.resolve(id, importer, { skipSelf: true })
            || await this.resolve(id, __filename, { skipSelf: true });
        },
      }],
    });
    if (ui && ctx?.shouldKeepServer()) {
      // Keep configuration import fallbacks alive across watch-mode restarts.
      await new Promise(resolve => {
        const stop = async () => {
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          await ctx.close();
          resolve();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    }
  } finally {
    try { await ctx?.close(); }
    finally { hooks.deregister(); }
  }
}

module.exports = { runTests };
