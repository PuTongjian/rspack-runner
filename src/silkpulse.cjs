const HtmlPlugin = require('html-webpack-plugin');

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
  constructor(server) {
    this.server = resolveSilkpulseServer(true, server);
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('SilkPulsePlugin', compilation => {
      HtmlPlugin.getHooks(compilation).alterAssetTagGroups.tap('SilkPulsePlugin', data => {
        // HtmlPlugin serializes attributes verbatim; preserve URL ampersands as HTML entities.
        const server = this.server.replace(/&/g, '&amp;');
        // A synchronous script must install the Vue DevTools hook before application bundles run.
        data.headTags.unshift(HtmlPlugin.createHtmlTagObject('script', {
          src: server + '/sdk.js', crossorigin: 'anonymous', 'data-server': server, 'data-floating-ball': '0',
        }));
        return data;
      });
    });
  }
}

module.exports = { resolveSilkpulseServer, SilkPulsePlugin };
