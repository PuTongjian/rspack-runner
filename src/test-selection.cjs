const fs = require('node:fs/promises');
const path = require('node:path');

async function discoverConfigs(directory) {
  const configs = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
      configs.push(...await discoverConfigs(file));
    } else if (entry.isFile() && /^vitest(?:\.[\w-]+)*\.config\.(?:[cm]?[jt]s)$/.test(entry.name)) {
      configs.push(file);
    }
  }
  return configs.sort();
}

async function selectConfigs(configs) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Vitest configs found. Use --config PATH in a non-interactive terminal.');
  }
  const { createElement: h, useState } = await import('react');
  const { render, Text, Box, useInput, useApp } = await import('ink');
  let selected = [];
  let cancelled = false;
  function Picker() {
    const [cursor, setCursor] = useState(0);
    const [checked, setChecked] = useState(new Set());
    const { exit } = useApp();
    useInput((input, key) => {
      if (key.escape || (key.ctrl && input === 'c')) { cancelled = true; exit(); return; }
      if (key.upArrow) setCursor(index => (index + configs.length - 1) % configs.length);
      if (key.downArrow) setCursor(index => (index + 1) % configs.length);
      if (input === ' ') setChecked(previous => {
        const next = new Set(previous);
        if (next.has(cursor)) next.delete(cursor); else next.add(cursor);
        return next;
      });
      if (key.return && checked.size) {
        selected = configs.filter((_, index) => checked.has(index));
        exit();
      }
    });
    const start = Math.max(0, cursor - 9);
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, 'Select Vitest configs (↑/↓ move, Space select, Enter run, Esc cancel)'),
      h(Text, null, `${checked.size} selected · ${cursor + 1}/${configs.length}`),
      ...configs.slice(start, start + 10).map((file, offset) => {
        const index = start + offset;
        return h(Text, { key: file, color: index === cursor ? 'cyan' : undefined },
          `${index === cursor ? '❯' : ' '} [${checked.has(index) ? 'x' : ' '}] ${path.relative(process.cwd(), file)}`);
      }));
  }
  const app = render(h(Picker), { exitOnCtrlC: false });
  try { await app.waitUntilExit(); }
  finally { app.unmount(); app.cleanup(); }
  if (cancelled) throw new Error('Vitest config selection cancelled.');
  return selected;
}

async function runTestCommand(options) {
  const { runTests } = require('./test-runner.cjs');
  if (options.config !== undefined) return runTests(options);
  const configs = await discoverConfigs(process.cwd());
  if (!configs.length) return runTests(options);
  const selected = await module.exports.selectConfigs(configs);
  if (options.ui && (options.port ?? 51204) + selected.length - 1 > 65535) {
    throw new Error('Not enough UI ports for the selected Vitest configs. Choose a lower --port.');
  }
  const directory = options.directory === undefined ? undefined
    : path.resolve(options.project || process.cwd(), options.directory);
  const run = (config, index) => runTests({ ...options, config, directory,
    project: options.project || process.cwd(),
    ...(options.ui ? { port: (options.port ?? 51204) + index } : {}),
  });
  if (options.ui) await Promise.all(selected.map(run));
  else {
    const errors = [];
    for (const [index, config] of selected.entries()) {
      try { await run(config, index); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('\n'));
  }
}

module.exports = { discoverConfigs, selectConfigs, runTestCommand };
