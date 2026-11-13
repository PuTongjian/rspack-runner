const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

async function launch(payloadPath, hash) {
  const cache = path.join(os.homedir(), '.cache', 'rspack-runner', 'runtime');
  const destination = path.join(cache, hash);
  if (!fs.existsSync(path.join(destination, '.ready'))) {
    fs.mkdirSync(cache, { recursive: true });
    const staging = fs.mkdtempSync(path.join(cache, '.extract-'));
    try {
      const payload = await Bun.file(payloadPath).arrayBuffer();
      if (createHash('sha256').update(Buffer.from(payload)).digest('hex') !== hash) throw new Error('Embedded payload checksum mismatch.');
      await new Bun.Archive(payload).extract(staging);
      fs.writeFileSync(path.join(staging, '.ready'), '');
      try { fs.renameSync(staging, destination); }
      catch (error) { if (!fs.existsSync(path.join(destination, '.ready'))) throw error; }
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }
  const bun = path.join(destination, 'bin', 'bun');
  const child = spawn(bun, [path.join(destination, 'src', 'cli.cjs'), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, PATH: `${path.dirname(bun)}${path.delimiter}${process.env.PATH || ''}` },
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (128 + (os.constants.signals[signal] || 0)); });
}
module.exports = { launch };
