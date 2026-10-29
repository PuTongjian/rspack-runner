const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');

test('brew install and update use a complete local source archive without custom environment variables', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-brew-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const tap = path.join(directory, 'Library/Taps/local/homebrew-rspack-runner');
  await fs.mkdir(tap, { recursive: true });
  const preload = path.join(directory, 'preload.cjs');
  await fs.writeFile(preload, `
const cp = require('node:child_process');
const original = cp.spawnSync;
cp.spawnSync = (command, args, options) => {
  if (!command.endsWith('/brew') && command !== 'brew') return original(command, args, options);
  if (args[0] === '--repository') return { status: 0, stdout: ${JSON.stringify(directory)} };
  if (options.env.RSPACK_RUNNER_SOURCE) throw new Error('Homebrew does not preserve RSPACK_RUNNER_SOURCE');
  if (args.includes('--HEAD')) throw new Error('Local archives must use the normal version for HEAD migration');
  return { status: 0 };
};
`);
  for (const command of ['install', 'update']) {
    const result = spawnSync(process.execPath, ['--require', preload, path.resolve(__dirname, '../scripts/brew.cjs'), command], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const formula = await fs.readFile(path.join(tap, 'Formula/rspack-runner.rb'), 'utf8');
    assert.doesNotMatch(formula, /RSPACK_RUNNER_SOURCE/);
    assert.doesNotMatch(formula, /^\s*head\b/m);
    const archiveURL = formula.match(/url "(file:[^"]+)"/)?.[1];
    assert.ok(archiveURL, 'local formula must download the current source archive');
    const archive = fileURLToPath(archiveURL);
    const extracted = path.join(directory, command);
    await fs.mkdir(extracted);
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(unpack.status, 0, unpack.stderr);
    for (const file of ['.node-version', 'package.json', 'package-lock.json', 'scripts/build-executable.cjs', 'scripts/executable-bootstrap.cjs', 'src/test-runner.cjs']) {
      assert.equal(await fs.readFile(path.join(extracted, file), 'utf8'), await fs.readFile(path.resolve(__dirname, '..', file), 'utf8'));
    }
  }
});
