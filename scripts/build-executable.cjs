const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const root = path.resolve(__dirname, '..');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd, stdio: 'inherit',
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await pipeline(response.body, createWriteStream(destination));
}

async function main() {
  const platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'linux-x64', 'linux-arm64'].includes(platform)) {
    throw new Error(`Unsupported executable platform: ${platform}`);
  }
  const version = (await fs.readFile(path.join(root, '.node-version'), 'utf8')).trim();
  const name = `node-v${version}-${platform}`;
  const cache = path.join(root, '.cache', 'runtime');
  const runtime = path.join(cache, name);
  const node = path.join(runtime, 'bin', 'node');
  await fs.mkdir(cache, { recursive: true });
  try {
    await fs.access(node);
  } catch {
    const archive = path.join(cache, `${name}.tar.gz`);
    const baseURL = `https://nodejs.org/dist/v${version}`;
    console.log(`[package] Downloading Node ${version} for ${platform}`);
    await download(`${baseURL}/${name}.tar.gz`, archive);
    const response = await fetch(`${baseURL}/SHASUMS256.txt`);
    if (!response.ok) throw new Error('Failed to download Node checksums.');
    const checksum = (await response.text()).split('\n').find(line => line.endsWith(`  ${name}.tar.gz`))?.split(' ')[0];
    if (!checksum || await sha256(archive) !== checksum) throw new Error('Node archive checksum mismatch.');
    run('tar', ['-xzf', archive, '-C', cache]);
  }
  if (process.versions.node !== version) {
    run(node, [__filename]);
    return;
  }

  const stage = await fs.mkdtemp(path.join(root, '.cache', 'package-'));
  try {
    for (const entry of ['package.json', 'package-lock.json', 'src', 'README.md']) {
      await fs.cp(path.join(root, entry), path.join(stage, entry), { recursive: true });
    }
    run(node, [path.join(runtime, 'lib/node_modules/npm/bin/npm-cli.js'), 'ci', '--omit=dev', '--no-audit', '--no-fund'], stage);
    await fs.mkdir(path.join(stage, 'bin'));
    await fs.copyFile(node, path.join(stage, 'bin', 'node'));
    await fs.chmod(path.join(stage, 'bin', 'node'), 0o755);

    const { zipFiles } = require('node:zlib');
    const files = (await fs.readdir(stage, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => {
        const file = path.join(entry.parentPath, entry.name);
        return [file, path.relative(stage, file).split(path.sep).join('/')];
      });
    const payload = path.join(stage, 'payload.zip');
    await pipeline(zipFiles(files), createWriteStream(payload));
    const manifest = path.join(stage, 'manifest.json');
    await fs.writeFile(manifest, JSON.stringify({ hash: await sha256(payload), node: version, platform }));
    const dist = path.join(root, 'dist');
    await fs.mkdir(dist, { recursive: true });
    const output = path.join(dist, 'rspack-runner');
    const config = path.join(stage, 'sea-config.json');
    await fs.writeFile(config, JSON.stringify({
      main: path.join(root, 'scripts', 'executable-bootstrap.cjs'),
      output, disableExperimentalSEAWarning: true,
      assets: { 'payload.zip': payload, 'manifest.json': manifest },
    }));
    run(node, ['--build-sea', config]);
    if (process.platform === 'darwin') run('codesign', ['--sign', '-', output]);
    await fs.chmod(output, 0o755);
    console.log(`[package] Built ${output} (Node ${version}, ${platform})`);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
