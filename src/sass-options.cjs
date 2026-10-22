function modernSassOptions(options = {}) {
  const { outputStyle, indentedSyntax, includePaths, ...modern } = options;
  if (outputStyle !== undefined) modern.style = outputStyle;
  if (indentedSyntax !== undefined) modern.syntax = indentedSyntax ? 'indented' : 'scss';
  if (includePaths !== undefined) modern.loadPaths = includePaths;
  return modern;
}

function adaptSass(use) {
  const options = use.options || {};
  const sassOptions = context => {
    const modern = modernSassOptions(typeof options.sassOptions === 'function' ? options.sassOptions(context) : options.sassOptions);
    // Vue CLI also sends CSS through Sass when additionalData is configured.
    if (context.resourcePath.endsWith('.css') && options.additionalData) modern.syntax ??= 'scss';
    return modern;
  };
  return {
    ...use, loader: require.resolve('sass-loader'),
    options: { ...options, sassOptions, implementation: require.resolve('sass-embedded'), api: 'modern-compiler' },
  };
}

module.exports = { adaptSass, modernSassOptions };
