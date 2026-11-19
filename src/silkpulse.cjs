const HtmlPlugin = require('html-webpack-plugin');

const vueHighPerfAsset = 'rspack-runner-silkpulse-vue-high-perf.js';

function resolveSilkpulseServer(enabled, server, command = 'dev') {
  if (!enabled && server === undefined) return undefined;
  if (command !== 'dev') throw new Error('--silkpulse and --silkpulse-server are only supported by run/dev.');
  if (!enabled) throw new Error('--silkpulse-server requires --silkpulse.');
  if (!server) throw new Error('--silkpulse requires --silkpulse-server.');
  let url;
  try { url = new URL(server); } catch { /* Report the same error for all invalid server URLs. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--silkpulse-server must be an HTTP(S) server URL without credentials, query, or fragment.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

class SilkPulsePlugin {
  constructor(server, vueHighPerf = false) {
    this.server = resolveSilkpulseServer(true, server);
    this.vueHighPerf = vueHighPerf;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('SilkPulsePlugin', compilation => {
      if (this.vueHighPerf) {
        const { Compilation, sources } = compiler.webpack;
        compilation.hooks.processAssets.tap({ name: 'SilkPulsePlugin', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
          compilation.emitAsset(vueHighPerfAsset, new sources.RawSource('window.__VUE_DEVTOOLS_UPDATE_CLIENT_DETECTED__?.({ iframe: false });\n'));
        });
      }
      HtmlPlugin.getHooks(compilation).alterAssetTagGroups.tap('SilkPulsePlugin', data => {
        // HtmlPlugin serializes attributes verbatim; preserve URL ampersands as HTML entities.
        const server = this.server.replace(/&/g, '&amp;');
        // A synchronous script must install the Vue DevTools hook before application bundles run.
        const sdkTag = HtmlPlugin.createHtmlTagObject('script', {
          src: server + '/sdk.js', crossorigin: 'anonymous', 'data-server': server, 'data-floating-ball': '1',
        });
        data.headTags.unshift(sdkTag);
        // The SDK sets its Vue hook synchronously; override its initial mode before the app starts.
        if (this.vueHighPerf) data.headTags.splice(1, 0, HtmlPlugin.createHtmlTagObject('script', {
          src: data.publicPath.replace(/&/g, '&amp;') + vueHighPerfAsset,
        }));
        return data;
      });
    });
  }
}

module.exports = { resolveSilkpulseServer, SilkPulsePlugin };
