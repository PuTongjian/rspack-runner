const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function main() {
  const platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'linux-x64', 'linux-arm64'].includes(platform)) throw new Error(`Unsupported executable platform: ${platform}`);
  await fs.mkdir(path.join(root, '.cache'), { recursive: true });
  const stage = await fs.mkdtemp(path.join(root, '.cache', 'package-'));
  try {
    const payload = path.join(stage, 'payload');
    await fs.mkdir(payload);
    for (const entry of ['package.json', 'bun.lock', 'src']) await fs.cp(path.join(root, entry), path.join(payload, entry), { recursive: true });
    run(process.execPath, ['install', '--production', '--frozen-lockfile', '--linker', 'hoisted', '--no-progress', '--no-summary'], payload);
    await fs.mkdir(path.join(payload, 'bin'));
    await fs.copyFile(process.execPath, path.join(payload, 'bin', 'bun'));
    await fs.chmod(path.join(payload, 'bin', 'bun'), 0o755);
    // Dependencies with a node shebang and Vitest workers use the bundled Bun.
    await fs.symlink('bun', path.join(payload, 'bin', 'node'));
    const archive = path.join(stage, 'payload.tar.gz');
    run('tar', ['-czf', archive, '-C', payload, '.']);
    const hash = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
    const entry = path.join(stage, 'bootstrap.mjs');
    await fs.writeFile(entry, `import payload from './payload.tar.gz' with { type: 'file' };\nimport { launch } from ${JSON.stringify(path.join(root, 'scripts/executable-bootstrap.cjs'))};\nawait launch(payload, ${JSON.stringify(hash)});\n`);
    const output = path.join(root, 'dist', 'rspack-runner');
    await fs.mkdir(path.dirname(output), { recursive: true });
    run(process.execPath, ['build', '--compile', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--outfile', output, entry]);
    if (process.platform === 'darwin') run('codesign', ['--sign', '-', output]);
    await fs.chmod(output, 0o755);
    console.log(`[package] Built ${output} (Bun ${Bun.version}, ${platform})`);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
