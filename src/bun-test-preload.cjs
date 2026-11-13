// Bun's vm context cannot host jsdom's Window EventTarget implementation.
const jsdom = require('jsdom');
const JSDOM = jsdom.JSDOM;
jsdom.JSDOM = class extends JSDOM {
  constructor(html, options) {
    super(html, { ...options, runScripts: undefined });
  }
};
