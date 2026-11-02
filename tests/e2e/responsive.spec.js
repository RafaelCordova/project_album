import { test, expect } from '@playwright/test';
import { backend, fixtureImage, login } from './fixtures.js';
import { examplePhoto } from '../unit/helpers.js';

// Las capturas explícitas cubren la revisión visual sin retener decenas de trazas de layout.
test.use({ trace: 'off' });

const screens = [
  [320, 568], [360, 640], [375, 812], [390, 844], [414, 896],
  [568, 320], [667, 375], [600, 960], [760, 600], [761, 600],
  [768, 1024], [820, 1180], [1024, 768], [1280, 720], [1440, 900], [1920, 1080],
];
const longName = `Nuestro_viaje_${'un_recuerdo_para_siempre_'.repeat(8)}.png`;

async function withinScreen(page, selector) {
  const issues = await page.locator(selector).evaluateAll((nodes) => nodes.flatMap((node) => {
    if (!node.checkVisibility()) return [];
    const rect = node.getBoundingClientRect();
    const problems = [];
    if (rect.left < -1 || rect.right > window.innerWidth + 1) problems.push(`${node.className}: fuera del ancho visible`);
    if (node.scrollWidth > node.clientWidth + 1) problems.push(`${node.className}: contenido desbordado`);
    return problems;
  }));
  expect(issues).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function touchTargets(page, selector) {
  const small = await page.locator(selector).evaluateAll((nodes) => nodes.flatMap((node) => {
    if (!node.checkVisibility()) return [];
    const rect = node.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44 ? [`${node.className}: ${rect.width} × ${rect.height}`] : [];
  }));
  expect(small).toEqual([]);
}

for (const [width, height] of screens) {
  test(`pantallas y controles a ${width} × ${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const rows = Array.from({ length: 6 }, (_, index) => ({ ...examplePhoto, id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, original_name: index === 0 ? longName : `Recuerdo ${index + 1}.png` }));
    const imageBody = await fixtureImage(page, ...(width < 600 ? [500, 1400] : [1600, 700]));
    await backend(page, { rows, imageBody });
    await page.goto('./');
    await expect(page.locator('.auth-form')).toBeVisible();
    await withinScreen(page, '.auth-page, .auth-panel, .auth-form-wrap, .auth-form, .auth-form button, .auth-form input');
    if (width === 320) await page.screenshot({ path: testInfo.outputPath('login-320.png'), fullPage: true });
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await withinScreen(page, '.auth-panel, .auth-form-wrap, .auth-form, .auth-form button');
    await login(page);
    await expect(page.locator('.photo-card')).toHaveCount(6);
    await page.locator('.photo-open img').evaluateAll((images) => images.forEach((image) => { image.loading = 'eager'; }));
    await expect.poll(() => page.locator('.photo-open img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
    for (const theme of ['neutral', 'blue', 'rose']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await withinScreen(page, '.header-inner, .account, .album-main, .album-hero, .upload-zone, .gallery-toolbar, .photo-grid, .photo-card, .site-footer');
      if ([320, 820, 1920].includes(width) && theme === 'rose') await page.screenshot({ path: testInfo.outputPath(`album-${width}.png`), fullPage: true });
    }
    await page.locator('.photo-open').first().click();
    await expect(page.locator('.lightbox-image')).toBeVisible();
    await withinScreen(page, '.lightbox, .lightbox-image, .lightbox-caption, .lightbox-close, .lightbox-nav');
    const fits = await page.locator('.lightbox-image').evaluate((image) => {
      const box = image.getBoundingClientRect();
      const stage = image.parentElement.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= stage.left - 1 && box.right <= stage.right + 1 && box.top >= stage.top - 1 && box.bottom <= stage.bottom + 1 && Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight) < 0.03;
    });
    expect(fits, 'El original completo debe caber sin deformarse ni quedar recortado').toBe(true);
    await expect(page.getByRole('region', { name: 'Nombre y fecha del recuerdo' })).toHaveAttribute('tabindex', '0');
    if ([320, 568, 820].includes(width)) await page.screenshot({ path: testInfo.outputPath(`lightbox-${width}.png`) });
    const overlaps = await page.evaluate(() => {
      const caption = document.querySelector('.lightbox-caption').getBoundingClientRect();
      return [...document.querySelectorAll('.lightbox-nav')].some((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < caption.right && rect.right > caption.left && rect.top < caption.bottom && rect.bottom > caption.top;
      });
    });
    expect(overlaps, 'La navegación no debe cubrir el nombre ni la fecha').toBe(false);
    await page.keyboard.press('Escape');
    await page.locator('.delete-photo').first().click();
    await expect(page.locator('.confirm-dialog')).toBeVisible();
    await withinScreen(page, '.confirm-dialog, .confirm-filename, .dialog-actions, .dialog-actions button');
    if ([320, 568].includes(width)) await page.screenshot({ path: testInfo.outputPath(`confirm-${width}.png`) });
    for (const name of ['Conservar recuerdo', 'Sí, eliminar']) {
      await page.getByRole('button', { name, exact: true }).scrollIntoViewIfNeeded();
      // El desplazamiento puede redondear fracciones de píxel en el borde inferior.
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 0.99 });
    }
    await page.getByRole('button', { name: 'Conservar recuerdo' }).click();
    await touchTargets(page, '.account button, .delete-photo');
    await expect(page.getByRole('button', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
    await expect(page.getByLabel('Nueva contraseña')).toBeVisible();
    await withinScreen(page, '.auth-page, .auth-panel, .auth-form-wrap, .auth-form, .auth-form button, .auth-form input');
    if ([320, 820, 1920].includes(width)) await page.screenshot({ path: testInfo.outputPath(`password-${width}.png`), fullPage: true });
  });
}

test('mensajes, cola de subida y estado vacío a 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await backend(page);
  await login(page);
  await expect(page.locator('.empty-state')).toBeVisible();
  await withinScreen(page, '.empty-state, .gallery-toolbar');
  await page.locator('#photo-files').setInputFiles({ name: `${longName}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from('archivo de prueba rechazado') });
  await expect(page.locator('.queue-error')).toBeVisible();
  await withinScreen(page, '.upload-zone, .upload-queue, .queue-name, .queue-status');
  await page.evaluate(async () => {
    const { notify } = await import('/prueba-album/src/components/ui.js');
    notify(`Aviso de prueba ${'referencia_larga_'.repeat(45)}`, 'error');
  });
  await expect(page.locator('.notice')).toBeVisible();
  await withinScreen(page, '.notifications, .notice');
  await touchTargets(page, '.notice button');
  await page.getByRole('button', { name: 'Cerrar aviso' }).click();
  await expect(page.locator('.notice')).toHaveCount(0);
});

test('denegación de acceso legible en móvil y en horizontal', async ({ page }) => {
  await backend(page, { nonMember: true });
  await login(page);
  await expect(page.locator('.message-card')).toBeVisible();
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(viewport);
    await withinScreen(page, '.message-page, .message-card, .message-card .brand, .message-card button');
  }
});

test('uso táctil y rotación con el lightbox abierto', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await context.newPage();
  try {
    await backend(page, { photos: true, imageBody: await fixtureImage(page, 1600, 400) });
    await login(page);
    await expect(page.locator('.photo-card')).toBeVisible();
    await page.locator('.photo-open').tap();
    await expect(page.locator('.lightbox-image')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await withinScreen(page, '.lightbox, .lightbox-image, .lightbox-caption, .lightbox-close, .lightbox-nav');
    await page.getByRole('button', { name: 'Cerrar vista ampliada' }).tap();
    await touchTargets(page, '.account button, .delete-photo');
    await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).tap();
    await expect(page.getByLabel('Nueva contraseña')).toBeVisible();
    expect(await page.getByLabel('Nueva contraseña').evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);
  } finally { await context.close(); }
});
