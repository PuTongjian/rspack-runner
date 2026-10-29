const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getAsset, getRawAsset } = require('node:sea');
const { spawn } = require('node:child_process');

async function main() {
  const manifest = JSON.parse(getAsset('manifest.json', 'utf8'));
  const cache = path.join(os.homedir(), '.cache', 'rspack-runner', 'runtime');
  const destination = path.join(cache, manifest.hash);
  if (!fs.existsSync(path.join(destination, '.ready'))) {
    fs.mkdirSync(cache, { recursive: true });
    const staging = fs.mkdtempSync(path.join(cache, '.extract-'));
    try {
      const payload = Buffer.from(getRawAsset('payload.zip'));
      if (createHash('sha256').update(payload).digest('hex') !== manifest.hash) throw new Error('Embedded payload checksum mismatch.');
      const { ZipBuffer } = require('node:zlib');
      for (const [name, entry] of new ZipBuffer(payload)) {
        const target = path.resolve(staging, name);
        if (!target.startsWith(staging + path.sep)) throw new Error(`Invalid payload path: ${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await entry.content(), { mode: entry.mode & 0o777 || 0o644 });
      }
      fs.chmodSync(path.join(staging, 'bin', 'node'), 0o755);
      fs.writeFileSync(path.join(staging, '.ready'), '');
      try {
        fs.renameSync(staging, destination);
      } catch (error) {
        if (!fs.existsSync(path.join(destination, '.ready'))) throw error;
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  const node = path.join(destination, 'bin', 'node');
  const child = spawn(node, [path.join(destination, 'src', 'cli.cjs'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH || ''}` },
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (128 + (os.constants.signals[signal] || 0)); });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
