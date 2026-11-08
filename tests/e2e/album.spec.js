import { test, expect } from '@playwright/test';
import { backend, login, tokenData, user } from './fixtures.js';

test('login accesible, errores claros y ningún dato privado antes de autenticarse', async ({ page }) => {
  const mock = await backend(page, { invalidLogin: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Lo mejor de la vida, contigo.' })).toBeVisible();
  await expect(page.locator('.auth-page')).toHaveCSS('display', 'grid');
  await expect(page.locator('.gallery')).toHaveCount(0);
  expect(mock.requests.some((request) => request.path.includes('album_photos'))).toBe(false);
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await page.getByLabel('Tu correo electrónico').fill(user.email);
  await page.getByLabel('Tu contraseña', { exact: true }).fill('INVALIDA_DE_PRUEBA');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('status')).toContainText('Correo o contraseña incorrectos.');
  expect(errors).toEqual([]);
});

test('rechaza una cuenta autenticada sin membresía sin pedir fotografías', async ({ page }) => {
  const mock = await backend(page, { nonMember: true });
  await login(page);
  await expect(page.getByRole('heading', { name: 'No pudimos abrir el álbum.' })).toBeVisible();
  await expect(page.getByText('Esta cuenta no pertenece al álbum.', { exact: false })).toBeVisible();
  expect(mock.requests.some((request) => request.path.includes('album_photos'))).toBe(false);
});

test('sube original y miniatura, restaura sesión, abre lightbox y elimina con confirmación', async ({ page }) => {
  const mock = await backend(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await expect(page.getByText('Toda historia empieza con un momento.')).toBeVisible();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 800;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 800);
    gradient.addColorStop(0, '#a3bcb4'); gradient.addColorStop(1, '#f1d4a6');
    context.fillStyle = gradient; context.fillRect(0, 0, 1200, 800);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#photo-files').setInputFiles({ name: 'Nuestro primer recuerdo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  // v2: la selección se muestra primero en una vista previa y se confirma.
  await page.getByRole('button', { name: 'Guardar en el álbum' }).click();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  expect(mock.uploads).toHaveLength(3);
  expect(mock.uploads[0]).toContain('/originals/');
  expect(mock.uploads[1]).toContain('/thumbnails/');
  expect(mock.uploads[2]).toContain('/display/');
  expect(mock.rows[0].thumbnail_path).toMatch(/\.webp$/);
  expect(mock.rows[0].display_path).toMatch(/^display\/.*\.webp$/);
  await page.reload();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ampliar Nuestro primer recuerdo.png' }).click();
  await expect(page.getByRole('dialog', { name: 'Fotografía ampliada' })).toBeVisible();
  // v2: el lightbox usa la versión optimizada, no el original.
  await expect(page.locator('.lightbox-image')).toHaveAttribute('src', /object\/sign\/recuerdos\/display/);
  await expect(page.locator('.lightbox-image')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Eliminar Nuestro primer recuerdo.png' }).click();
  await page.getByRole('button', { name: 'Conservar recuerdo' }).click();
  expect(mock.deletes).toHaveLength(0);
  await page.getByRole('button', { name: 'Eliminar Nuestro primer recuerdo.png' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.locator('.photo-card')).toHaveCount(0);
  expect(mock.deletes).toEqual(['storage', 'metadata']);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(page.getByLabel('Tu correo electrónico')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Tu correo electrónico')).toBeVisible();
  expect(errors).toEqual([]);
});

test('una eliminación de metadatos fallida mantiene la fila y se puede reintentar', async ({ page }) => {
  const mock = await backend(page, { photos: true, metadataDeleteFailures: 1 });
  await login(page);
  await page.getByRole('button', { name: 'Eliminar recuerdo.png' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.getByText('Los archivos se eliminaron, pero el registro sigue pendiente.', { exact: false })).toBeVisible();
  expect(mock.rows).toHaveLength(1);
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.locator('.photo-card')).toHaveCount(0);
  expect(mock.rows).toHaveLength(0);
});

test('si falta una miniatura en Storage, la galería usa el original privado', async ({ page }) => {
  await backend(page, { photos: true, missingThumbnail: true });
  await login(page);
  await expect(page.locator('.photo-open img')).toBeVisible();
  await expect(page.locator('.photo-open img')).toHaveAttribute('src', /object\/sign\/recuerdos\/originals/);
});

test('recuperación usa la subruta correcta y cambio de contraseña funciona con sesión de recuperación', async ({ page }) => {
  const mock = await backend(page);
  await page.goto('./');
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
  await page.getByLabel('Tu correo electrónico').fill(user.email);
  await page.getByRole('button', { name: 'Enviar enlace de recuperación' }).click();
  await expect(page.getByRole('status')).toContainText('Si la cuenta puede recibir correos');
  expect(mock.recoveryRedirect).toBe('http://127.0.0.1:5174/prueba-album/?recovery=1');
  const data = tokenData();
  const fragment = new URLSearchParams({ access_token: data.access_token, refresh_token: data.refresh_token, expires_in: '3600', token_type: 'bearer', type: 'recovery' });
  await page.goto(`./?recovery=1#${fragment}`);
  await expect(page.getByRole('heading', { name: 'Un nuevo comienzo.' })).toBeVisible();
  await page.getByLabel('Nueva contraseña').fill('NUEVA_SOLO_PARA_PRUEBA');
  await page.getByLabel('Repite la contraseña').fill('NUEVA_SOLO_PARA_PRUEBA');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Lo mejor de la vida, contigo.' })).toBeVisible();
  expect(mock.requests.some((request) => request.path === '/auth/v1/user' && request.method === 'PUT')).toBe(true);
});

test('móvil sin desbordamiento y nombres tratados como texto', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const mock = await backend(page, { photos: true });
  mock.rows[0].original_name = '<img src=x onerror=alert(1)>.png';
  await login(page);
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.photo-description h3')).toHaveText('<img src=x onerror=alert(1)>.png');
  await expect(page.locator('.album-hero')).toHaveCSS('display', 'grid');
  expect(await page.locator('.photo-description img').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/album-mobile.png', fullPage: true });
});
