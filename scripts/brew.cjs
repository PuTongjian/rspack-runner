#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const formulaName = 'rspack-runner';
const tap = process.env.RSPACK_RUNNER_TAP || 'local/rspack-runner';
const [owner, repository] = tap.split('/');
const brew = fs.existsSync('/opt/homebrew/bin/brew') ? '/opt/homebrew/bin/brew' : (fs.existsSync('/home/linuxbrew/.linuxbrew/bin/brew') ? '/home/linuxbrew/.linuxbrew/bin/brew' : 'brew');

if (!owner || !repository || tap.split('/').length !== 2) {
  throw new Error(`Invalid RSPACK_RUNNER_TAP: ${tap}. Expected owner/repository.`);
}

function run(command, args, options = {}) {
  const { env: extraEnv, ...spawnOptions } = options;
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...extraEnv }, ...spawnOptions });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: root });
  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}

function brewRepository() {
  const repository = capture(brew, ['--repository']);
  if (!repository) throw new Error('Homebrew is required. Install it from https://brew.sh/ first.');
  return repository;
}

function tapDirectory() {
  return path.join(brewRepository(), 'Library', 'Taps', owner, `homebrew-${repository}`);
}

function formulaPath() {
  return path.join(tapDirectory(), 'Formula', `${formulaName}.rb`);
}

function fixInstalledMode() {
  const prefix = capture(brew, ['--prefix', formulaName]);
  if (!prefix) return;
  const cli = path.join(prefix, 'libexec', 'src', 'cli.cjs');
  if (fs.existsSync(cli)) fs.chmodSync(cli, 0o755);
}

function syncInstalledFiles() {
  const prefix = capture(brew, ['--prefix', formulaName]);
  if (!prefix) return;
  const destination = path.join(prefix, 'libexec');
  for (const entry of ['package.json', 'package-lock.json', 'README.md', 'src', 'scripts']) {
    const target = path.join(destination, entry);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(root, entry), target, { recursive: true });
  }
  fixInstalledMode();
}

function ensureTap() {
  brewRepository();
  if (!fs.existsSync(tapDirectory())) run(brew, ['tap-new', tap]);
  fs.mkdirSync(path.dirname(formulaPath()), { recursive: true });
  fs.copyFileSync(path.join(root, 'Formula', `${formulaName}.rb`), formulaPath());
}

function install() {
  ensureTap();
  run(brew, ['install', '--HEAD', '--build-from-source', `${tap}/${formulaName}`], { env: { RSPACK_RUNNER_SOURCE: root } });
  syncInstalledFiles();
}

function update() {
  ensureTap();
  run(brew, ['reinstall', '--build-from-source', `${tap}/${formulaName}`], { env: { RSPACK_RUNNER_SOURCE: root } });
  syncInstalledFiles();
}

function uninstall() {
  brewRepository();
  run(brew, ['uninstall', '--force', formulaName], { stdio: 'inherit' });
  if (fs.existsSync(formulaPath())) fs.rmSync(formulaPath());
  if (fs.existsSync(tapDirectory())) run(brew, ['untap', tap]);
}

const command = process.argv[2];
if (command === 'install') install();
else if (command === 'update') update();
else if (command === 'uninstall') uninstall();
else {
  console.log('Usage: npm run brew:<install|update|uninstall>');
  console.log('Set RSPACK_RUNNER_TAP=owner/repository to use a different local tap.');
  process.exitCode = command ? 1 : 0;
}
