import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import assert from 'node:assert/strict';

const html = await readFile('dist/index.html', 'utf8');
const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
const stylesheet = html.match(/<link[^>]+href="([^"]+\.css)"/)[1];
const base = script.slice(0, script.indexOf('assets/'));
const server = await preview({ configFile: false, base, preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
let browser;
try {
  const origin = 'http://127.0.0.1:4175';
  for (const path of [base, script, stylesheet, `${base}favicon.svg`]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, `Recurso de producción: ${path}`);
  }
  browser = await chromium.launch(process.platform === 'win32' ? { channel: 'chrome' } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Smoke test de arranque únicamente, sin login y sin acceso al Supabase real.
  await page.route('https://**/*', (route) => route.abort());
  await page.goto(`${origin}${base}`);
  await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
  assert.ok(await page.locator('.message-page, .auth-page').count());
  assert.equal(await page.locator('.brand').first().evaluate((node) => getComputedStyle(node).display), 'flex');
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/production-start.png', fullPage: true });
  console.log(`Producción verificada en ${base}: entrada, JS, CSS, favicon y navegador sin errores.`);
} finally {
  await browser?.close();
  await new Promise((done, reject) => server.httpServer.close((error) => error ? reject(error) : done()));
}
