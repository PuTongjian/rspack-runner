#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const { rspack } = require('@rspack/core');
const { RspackDevServer } = require('@rspack/dev-server');
const { createConfig } = require('./adapter.cjs');

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' }, mode: { type: 'string', default: 'development' },
      port: { type: 'string' }, host: { type: 'string', default: 'localhost' },
      help: { type: 'boolean', short: 'h' },
      'no-lazy': { type: 'boolean' }, 'no-persistent-cache': { type: 'boolean' },
      'no-embedded-sass': { type: 'boolean' }, 'no-eval': { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('Usage: rspack-runner dev [--project PATH] [--mode development] [--port 8087] [--host localhost] [--no-lazy] [--no-persistent-cache] [--no-embedded-sass] [--no-eval]');
    return;
  }
  if (positionals.length > 1 || (positionals[0] && positionals[0] !== 'dev')) throw new Error('Only the dev command is supported.');
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('--port must be an integer between 1 and 65535.');
  const project = path.resolve(values.project || process.cwd());
  const { config, devServer, notices } = await createConfig({ project, mode: values.mode, host: values.host, port,
    lazy: !values['no-lazy'], persistent: !values['no-persistent-cache'], embeddedSass: !values['no-embedded-sass'],
    devtool: values['no-eval'] ? 'cheap-module-source-map' : 'eval-cheap-module-source-map',
  });
  console.log(`[rspack-runner] Project: ${project}`);
  notices.forEach(notice => console.log(`[adapter] ${notice}`));
  const compiler = rspack(config);
  compiler.hooks.done.tap('rspack-runner', stats => {
    console.log(`[rspack-runner] ${stats.hasErrors() ? 'Compilation failed' : 'Ready'} in ${stats.endTime - stats.startTime}ms → http://${values.host}:${devServer.port}`);
  });
  const server = new RspackDevServer(devServer, compiler);
  await server.start();
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
