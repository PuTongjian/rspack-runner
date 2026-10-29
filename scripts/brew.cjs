#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

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

function ensureTap() {
  brewRepository();
  if (!fs.existsSync(tapDirectory())) run(brew, ['tap-new', tap]);
  fs.mkdirSync(path.dirname(formulaPath()), { recursive: true });
  const cache = path.join(root, '.cache', 'brew');
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, 'source.tar.gz');
  run('tar', ['-czf', archive, '.node-version', 'package.json', 'package-lock.json', 'README.md', 'src', 'scripts'], { env: { COPYFILE_DISABLE: '1' } });
  const checksum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const sourceArchive = path.join(cache, `source-${checksum}.tar.gz`);
  fs.renameSync(archive, sourceArchive);
  const url = pathToFileURL(sourceArchive).href;
  const formula = fs.readFileSync(path.join(root, 'Formula', `${formulaName}.rb`), 'utf8')
    .replace(/^  head .*$/m, `  url "${url}"\n  sha256 "${checksum}"`);
  fs.writeFileSync(formulaPath(), formula);
}

function install() {
  ensureTap();
  run(brew, ['install', '--build-from-source', `${tap}/${formulaName}`]);
}

function update() {
  ensureTap();
  run(brew, ['reinstall', '--build-from-source', `${tap}/${formulaName}`]);
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
