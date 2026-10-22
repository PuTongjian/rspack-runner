const { createRequire } = require('node:module');

// shortcut: supports JavaScript-imported, inline sprites only; add an extraction
// adapter before supporting CSS imports or extract:true.
module.exports = function (content) {
  const done = this.async();
  const { originalLoader, ...options } = this.getOptions();
  const projectRequire = createRequire(require('node:path').join(this.rootContext, 'package.json'));
  const loaderPath = projectRequire.resolve(originalLoader || 'svg-sprite-loader');
  const loaderRequire = createRequire(loaderPath);
  if (options.extract) throw new Error('Rspack sprite adapter supports inline sprites only (extract:false).');
  const defaults = loaderRequire('./config').loader;
  const config = { ...defaults, ...options, extract: false };
  const { interpolateName } = loaderRequire('loader-utils');
  const SVGCompiler = loaderRequire('svg-baker');
  const id = typeof config.symbolId === 'function'
    ? config.symbolId(this.resourcePath, this.resourceQuery)
    : interpolateName(this, config.symbolId, { content, context: this.rootContext, regExp: config.symbolRegExp });
  const compiler = new SVGCompiler();
  compiler.addSymbol({ id, content, path: this.resourcePath + this.resourceQuery })
    .then(symbol => done(null, loaderRequire(config.runtimeGenerator)({ symbol, config, context: this.context, loaderContext: this })))
    .catch(done);
};
