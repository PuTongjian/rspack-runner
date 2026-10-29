const fs = require('node:fs/promises');
const path = require('node:path');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

async function runTests({ project, directory, config }) {
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
        if (error.code !== 'ERR_MODULE_NOT_FOUND' || !['vitest/config', 'vite'].includes(specifier)) throw error;
        return nextResolve(pathToFileURL(require.resolve(specifier)).href, context);
      }
    },
  });
  let ctx;
  try {
    ctx = await startVitest('test', directory ? [dir.split(path.sep).join('/') + '/'] : [], {
      root, run: true, configLoader: 'native',
      ...(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? { dir } : {}),
      ...(config === undefined ? {} : { config: path.resolve(root, config) }),
    });
  } finally {
    try { await ctx?.close(); }
    finally { hooks.deregister(); }
  }
}

module.exports = { runTests };
