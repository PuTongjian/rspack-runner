module.exports = function vueRuntimeCompatLoader(source) {
  const expression = 'currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce';
  const replacement = 'currentRenderingInstance && (currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce)';
  return source.includes(expression) ? source.replace(expression, replacement) : source;
};
