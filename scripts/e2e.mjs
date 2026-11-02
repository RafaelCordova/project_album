import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// Datos ficticios exclusivos de las pruebas. El navegador intercepta toda petición remota.
process.env.VITE_BASE_PATH = '/prueba-album/';
process.env.VITE_SUPABASE_URL = 'https://ycomlinemyhlwjaklxju.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TEST_ONLY_NOT_A_REAL_KEY';
const server = await createServer({ mode: 'e2e', server: { host: '127.0.0.1', port: 5174, strictPort: true, hmr: false } });
try {
  await server.listen();
  const child = spawn(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', (code) => done(code ?? 1)); });
} finally { await server.close(); }
