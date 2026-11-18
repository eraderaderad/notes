// Launches the real Electron app against a throwaway data folder, runs its built-in self-test and prints the result.
// Usage: node scripts/selftest.mjs [path-to-16k-mono-wav] [path-to-app-exe]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eradnotes-selftest-'));
// Reuse an already-downloaded speech model so the test can run offline.
const models = path.resolve('.devdata/models');
if (fs.existsSync(models)) fs.cpSync(models, path.join(dir, 'models'), { recursive: true });
const out = path.join(dir, 'result.json');
const exe = process.argv[3] || createRequire(import.meta.url)('electron');
const args = process.argv[3] ? [] : ['.'];
const env = { ...process.env, ERAD_DATA_DIR: dir, ERAD_SELFTEST: out };
if (process.argv[2]) env.ERAD_SELFTEST_WAV = path.resolve(process.argv[2]);

const child = spawn(exe, args, { env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill(), 180000);
child.on('exit', (code) => {
  clearTimeout(timer);
  const res = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '{"error":"no result written (app crashed or timed out)"}';
  console.log(res);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 1);
});
