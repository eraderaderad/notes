// npm run dev      -> Vite + the Electron app (hot reload)
// npm run dev:web  -> Vite + a local HTTP shim, for testing the UI in a browser
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const web = process.argv.includes('--web');
const vite = await createServer();
await vite.listen();
const url = vite.resolvedUrls.local[0];
console.log(`UI: ${url}`);

if (web) {
  const { startDevServer } = await import('../server/dev-server.js');
  startDevServer({ dataDir: path.resolve(process.env.ERAD_DATA_DIR || '.devdata'), port: +(process.env.ERAD_API_PORT || 5174) });
  console.log('Backend shim running on 127.0.0.1 (development only)');
} else {
  const electron = createRequire(import.meta.url)('electron');
  const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, ERAD_DEV_URL: url } });
  child.on('exit', async () => {
    await vite.close();
    process.exit(0);
  });
}
