import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  globalTimeout: 300_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174/prueba-album/',
    // Usa el navegador local de Windows; en otros sistemas, Chromium de Playwright.
    ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'chrome' } : {}),
    trace: 'retain-on-failure',
  },
});
