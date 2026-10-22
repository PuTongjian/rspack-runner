const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function cacheDependencies(project, mode, tsconfigFiles, rules) {
  const files = new Set(tsconfigFiles);
  for (const name of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'vue.config.js', 'vue.config.cjs', 'babel.config.js', 'babel.config.cjs', '.babelrc', '.babelrc.json', '.babelrc.js', '.babelrc.cjs', 'postcss.config.js', 'postcss.config.cjs', '.postcssrc', '.postcssrc.json', '.postcssrc.js', '.browserslistrc', '.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const file = path.join(project, name);
    if (fs.existsSync(file)) files.add(file);
  }
  for (const file of Object.keys(require.cache)) {
    if ((file.startsWith(project + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`)) || file.startsWith(__dirname + path.sep)) files.add(file);
  }
  const visit = rules => {
    for (const rule of rules) {
      for (const key of ['rules', 'oneOf']) if (rule[key]) visit(rule[key]);
      for (const use of rule.use || []) if (path.isAbsolute(use.loader || '') && !use.loader.includes(`${path.sep}node_modules${path.sep}`)) files.add(use.loader);
    }
  };
  visit(rules);
  files.add(path.resolve(__dirname, '../package-lock.json'));
  files.add(path.resolve(__dirname, '../package.json'));
  return [...files].sort();
}

function cacheVersion(files, compilerOptions, mode) {
  const hash = createHash('sha256').update(JSON.stringify({ compilerOptions, mode }));
  for (const file of files) hash.update(file).update(fs.readFileSync(file));
  return hash.digest('hex');
}

module.exports = { cacheDependencies, cacheVersion };
