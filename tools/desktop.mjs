#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = name => process.platform === 'win32' ? `${name}.exe` : name;
const localBin = join(root, '.tools', 'cargo', 'bin');
const env = { ...process.env };
const localToolchain = existsSync(join(localBin, executable('cargo')));
if (localToolchain) {
  env.CARGO_HOME = join(root, '.tools', 'cargo');
  env.RUSTUP_HOME = join(root, '.tools', 'rustup');
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${localBin}${delimiter}${env[pathKey] ?? ''}`;
}

function fail(message) {
  console.error(`Shorthand Writer: ${message}`);
  process.exit(1);
}
function version(name) {
  const command = localToolchain ? join(localBin, executable(name)) : name;
  const result = spawnSync(command, ['--version'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    const toolchain = process.platform === 'win32' ? 'Rust 1.90+ with the Windows MSVC toolchain' : 'Rust 1.90+';
    fail(`${name} is unavailable. Install ${toolchain}, or restore .tools/cargo and .tools/rustup.`);
  }
  return result.stdout.trim();
}

const [mode, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'test', 'check'].includes(mode)) {
  console.error('Usage: node tools/desktop.mjs <dev|build|test|check> [arguments]');
  process.exit(2);
}
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) fail('Node 22.12+ is required.');
const cargoVersion = version('cargo');
const rustVersion = version('rustc');
const rustMatch = /rustc (\d+)\.(\d+)/.exec(rustVersion);
if (!rustMatch || Number(rustMatch[1]) < 1 || (Number(rustMatch[1]) === 1 && Number(rustMatch[2]) < 90)) {
  fail(`Rust 1.90+ is required; found ${rustVersion}.`);
}
if (mode === 'check') {
  console.log(`Node ${process.versions.node}\n${cargoVersion}\n${rustVersion}\nToolchain: ${localToolchain ? 'repository-local .tools' : 'system PATH'}`);
  process.exit(0);
}

let command, commandArgs;
if (mode === 'test') {
  command = localToolchain ? join(localBin, executable('cargo')) : 'cargo';
  commandArgs = ['test', '--manifest-path', join(root, 'src-tauri', 'Cargo.toml'), ...args];
} else {
  const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!existsSync(cli)) fail('Desktop dependencies are missing. Run npm ci first.');
  command = process.execPath;
  commandArgs = [cli, mode, ...args];
}
const child = spawn(command, commandArgs, { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => fail(`Could not start ${mode}: ${error.message}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
