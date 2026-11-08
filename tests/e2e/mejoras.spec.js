import { test, expect } from '@playwright/test';
import { accounts, backend, CAPTCHA_TOKEN, createState, login, longVideo, shortVideo, user } from './fixtures.js';
import { examplePhoto, USER_ID } from '../unit/helpers.js';

// Recuerdos ficticios con fechas, lugares y tipos variados.
const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function memory(n, memory_date, extra = {}) {
  const owner = extra.uploaded_by || USER_ID;
  const video = extra.media_type === 'video';
  return {
    id: id(n),
    storage_path: `originals/${owner}/${id(n)}.${video ? 'mp4' : 'png'}`,
    thumbnail_path: `thumbnails/${owner}/${id(n)}.webp`,
    display_path: video ? null : `display/${owner}/${id(n)}.webp`,
    original_name: `Recuerdo ${n}.${video ? 'mp4' : 'png'}`,
    uploaded_by: owner,
    created_at: '2026-06-15T15:00:00Z',
    media_type: 'photo',
    memory_date,
    place: null,
    duration_seconds: video ? 3 : null,
    ...extra,
  };
}
const album = () => [
  memory(1, '2025-12-24', { place: 'Casa' }),
  memory(2, '2026-01-10', { place: 'Paracas', media_type: 'video' }),
  memory(3, '2026-01-02', { place: 'Paracas' }),
  memory(4, '2026-03-08', { place: 'Miraflores' }),
  memory(5, null, { created_at: '2026-02-20T15:00:00Z' }), // Recuerdo antiguo sin fecha ni lugar.
];
// Los filtros se buscan dentro de su grupo: el diálogo de edición también tiene un campo «Lugar».
const filter = (page, label) => page.getByRole('group', { name: 'Filtrar recuerdos' }).getByLabel(label, { exact: true });
// Recoge errores de JavaScript y violaciones de la CSP durante un flujo.
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && /Content Security Policy|Refused/i.test(message.text())) errors.push(message.text()); });
  return errors;
}
const fetched = (mock, fragment) => mock.requests.filter((request) => request.method === 'GET' && request.path.includes('/object/sign/') && request.path.includes(fragment));

test.describe('cuentas, temas y contraseña', () => {
  for (const [name, account, theme] of [['masculina', accounts.el, 'blue'], ['femenina', accounts.ella, 'rose']]) {
    test(`inicio de sesión con la cuenta ${name} y su tema ${theme}`, async ({ page }) => {
      await backend(page, { account, rows: album() });
      await login(page, account);
      await expect(page.locator('.photo-card')).toHaveCount(5);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.account-email')).toHaveText(account.email);
    });
  }

  test('mostrar y ocultar contraseña con ratón y teclado sin borrar el texto', async ({ page }) => {
    await backend(page);
    await page.goto('./');
    const password = page.getByLabel('Tu contraseña', { exact: true });
    await password.fill('MiClave-De-Prueba');
    const toggle = page.getByRole('button', { name: 'Mostrar contraseña' });
    await expect(password).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('MiClave-De-Prueba');
    await expect(page.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.password-toggle .when-visible')).toBeVisible();
    await page.getByRole('button', { name: 'Ocultar contraseña' }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await password.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(password).toHaveAttribute('type', 'text');
    await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('MiClave-De-Prueba');
  });

  test('el ojo funciona en móvil táctil y no afecta al inicio de sesión ni al cambio de contraseña', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const mock = await backend(page);
      await page.goto('./');
      await page.getByLabel('Tu correo electrónico').fill(user.email);
      await page.getByLabel('Tu contraseña', { exact: true }).fill('SOLO_PRUEBA_NO_ES_REAL');
      await page.getByRole('button', { name: 'Mostrar contraseña' }).tap();
      await expect(page.getByLabel('Tu contraseña', { exact: true })).toHaveAttribute('type', 'text');
      const box = await page.locator('.password-toggle').boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Ingresar' }).tap();
      await expect(page.getByText('Toda historia empieza con un momento.')).toBeVisible();
      const body = mock.requests.find((request) => request.path === '/auth/v1/token');
      expect(body).toBeTruthy();
      await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).tap();
      await expect(page.locator('.password-toggle')).toHaveCount(2);
      await page.getByLabel('Nueva contraseña').fill('NUEVA_SOLO_PARA_PRUEBA');
      await page.locator('.password-toggle').first().tap();
      await expect(page.getByLabel('Nueva contraseña')).toHaveAttribute('type', 'text');
      await expect(page.getByLabel('Repite la contraseña')).toHaveAttribute('type', 'password');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
});

test.describe('CAPTCHA (Turnstile simulado, validación en el servidor simulado)', () => {
  test('envía el token de un solo uso a Supabase Auth en login y recuperación', async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await backend(page);
    await page.goto('./');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
    await expect(page.locator('.fake-turnstile')).toBeVisible();
    expect(await page.evaluate(() => window.__turnstile.lastOptions)).toEqual({ sitekey: '1x00000000000000000000AA', action: 'login' });
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByLabel('Tu correo electrónico').fill(user.email);
    await page.getByRole('button', { name: 'Enviar enlace de recuperación' }).click();
    await expect(page.getByRole('status')).toContainText('Si la cuenta puede recibir correos');
    expect(mock.recoveryCaptcha).toMatch(new RegExp(`^${CAPTCHA_TOKEN}`));
    await login(page);
    await expect(page.getByText('Toda historia empieza con un momento.')).toBeVisible();
    expect(mock.captchaTokens).toHaveLength(1);
    expect(mock.captchaTokens[0]).toMatch(new RegExp(`^${CAPTCHA_TOKEN}`));
    expect(errors).toEqual([]);
  });

  test('si el CAPTCHA falla no se puede ingresar y se puede reintentar', async ({ page }) => {
    const mock = await backend(page, { captcha: 'fail' });
    await page.goto('./');
    await page.getByLabel('Tu correo electrónico').fill(user.email);
    await page.getByLabel('Tu contraseña', { exact: true }).fill('SOLO_PRUEBA_NO_ES_REAL');
    await expect(page.getByRole('status')).toContainText('La verificación de seguridad falló');
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
    await page.getByLabel('Tu contraseña', { exact: true }).press('Enter');
    expect(mock.requests.some((request) => request.path === '/auth/v1/token')).toBe(false);
    await page.getByRole('button', { name: 'Reintentar verificación' }).click();
    await expect.poll(() => page.evaluate(() => window.__turnstile.resets)).toBe(1);
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
  });

  test('un token rechazado por el servidor no bloquea: se renueva y el segundo intento entra', async ({ page }) => {
    const mock = await backend(page, { captchaRejections: 1 });
    await login(page);
    await expect(page.getByRole('status')).toContainText('La verificación de seguridad no fue válida');
    await expect.poll(() => page.evaluate(() => window.__turnstile.resets)).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
    await page.getByLabel('Tu contraseña', { exact: true }).fill('SOLO_PRUEBA_NO_ES_REAL');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByText('Toda historia empieza con un momento.')).toBeVisible();
    expect(mock.captchaTokens).toHaveLength(2);
    expect(mock.captchaTokens[0]).not.toBe(mock.captchaTokens[1]);
  });

  test('token vencido y script no disponible muestran cómo reintentar', async ({ page }) => {
    await backend(page, { captcha: 'expire' });
    await page.goto('./');
    await expect(page.getByRole('status')).toContainText('La verificación venció');
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
    await page.getByRole('button', { name: 'Reintentar verificación' }).click();
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
    const other = await page.context().newPage();
    await backend(other, { captcha: 'unavailable' });
    await other.goto('./');
    await expect(other.getByRole('status')).toContainText('No se pudo cargar la verificación de seguridad');
    await expect(other.getByRole('button', { name: 'Reintentar verificación' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Ingresar' })).toBeDisabled();
  });
});

test.describe('fotografías optimizadas', () => {
  test('la galería solo descarga miniaturas y el lightbox la versión optimizada', async ({ page }) => {
    const mock = await backend(page, { rows: album() });
    await login(page);
    await expect(page.locator('.photo-card')).toHaveCount(5);
    const first = page.locator('.photo-open img').first();
    await expect(first).toHaveAttribute('loading', 'lazy');
    await expect(first).toHaveAttribute('decoding', 'async');
    await page.locator('.photo-open img').evaluateAll((images) => images.forEach((image) => { image.loading = 'eager'; }));
    await expect.poll(() => fetched(mock, '/thumbnails/').length).toBe(5);
    expect(fetched(mock, '/originals/')).toHaveLength(0);
    expect(fetched(mock, '/display/')).toHaveLength(0);
    await page.getByRole('button', { name: 'Ampliar Recuerdo 4.png' }).click();
    await expect(page.locator('.lightbox-image')).toHaveAttribute('src', /object\/sign\/recuerdos\/display\//);
    await expect(page.locator('.lightbox-image')).toBeVisible();
    expect(fetched(mock, '/originals/')).toHaveLength(0);
  });

  test('las fotos anteriores siguen visibles aunque falte la migración', async ({ page }) => {
    const mock = await backend(page, { photos: true, legacySchema: true });
    await login(page);
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await expect(page.locator('.photo-open img')).toHaveAttribute('src', /thumbnails/);
    await expect(page.locator('.edit-photo')).toHaveCount(0);
    await expect(page.locator('#photo-files')).toHaveAttribute('accept', /image\/webp$/);
    await expect(filter(page, 'Tipo').locator('option')).toHaveText(['Fotos y videos', 'Solo fotografías']);
    await page.getByRole('button', { name: `Ampliar ${examplePhoto.original_name}` }).click();
    // Respaldo seguro: sin versión optimizada se abre el original privado firmado.
    await expect(page.locator('.lightbox-image')).toHaveAttribute('src', /object\/sign\/recuerdos\/originals/);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: `Eliminar ${examplePhoto.original_name}` }).click();
    await page.getByRole('button', { name: 'Sí, eliminar' }).click();
    await expect(page.locator('.photo-card')).toHaveCount(0);
    expect(mock.deletes).toEqual(['storage', 'metadata']);
  });
});

test.describe('videos cortos', () => {
  test('vista previa, cancelar, subir con progreso, portada en la galería y reproducción bajo demanda', async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await backend(page);
    await login(page);
    await expect(page.getByText('Toda historia empieza con un momento.')).toBeVisible();
    const file = { name: 'Nuestro abrazo.mp4', mimeType: 'video/mp4', buffer: shortVideo };
    await page.locator('#photo-files').setInputFiles(file);
    await expect(page.locator('.upload-preview video')).toBeVisible();
    await expect(page.locator('.upload-preview-meta')).toContainText('Video · 3 s');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.upload-panel')).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Selección cancelada' })).toBeVisible();
    expect(mock.uploads).toHaveLength(0);
    await page.locator('#photo-files').setInputFiles(file);
    await page.getByLabel('Lugar (opcional)').fill('Miraflores');
    await page.getByLabel('Fecha del recuerdo (opcional)').fill('2026-02-14');
    await page.getByRole('button', { name: 'Guardar en el álbum' }).click();
    await expect(page.locator('.photo-card.is-video')).toHaveCount(1);
    expect(mock.uploads[0]).toMatch(/\/originals\/.+\.mp4$/);
    expect(mock.uploadTypes[0]).toBe('video/mp4'); // Tipo MIME del archivo dentro del multipart.
    expect(mock.uploads[1]).toMatch(/\/thumbnails\/.+\.webp$/);
    expect(mock.rows[0]).toMatchObject({ media_type: 'video', duration_seconds: 3, place: 'Miraflores', memory_date: '2026-02-14', display_path: null });
    await expect(page.locator('.video-badge')).toContainText('3 s');
    await expect(page.locator('.month-heading').first()).toContainText('Febrero de 2026');
    // La galería no descarga el video: solo su portada.
    expect(fetched(mock, '.mp4')).toHaveLength(0);
    await page.getByRole('button', { name: 'Reproducir Nuestro abrazo.mp4' }).click();
    const video = page.locator('.lightbox-video');
    await expect(page.getByRole('dialog', { name: 'Video ampliado' })).toBeVisible();
    await expect(video).toHaveAttribute('src', /object\/sign\/recuerdos\/originals\/.+\.mp4/);
    await expect(video).toHaveAttribute('controls', '');
    await expect.poll(() => video.evaluate((node) => node.readyState)).toBeGreaterThanOrEqual(1);
    expect(await video.evaluate((node) => node.paused && !node.autoplay)).toBe(true); // Sin reproducción automática.
    await video.evaluate((node) => { node.muted = true; return node.play(); });
    await expect.poll(() => video.evaluate((node) => !node.paused && node.currentTime > 0)).toBe(true);
    await video.evaluate((node) => node.pause());
    expect(await video.evaluate((node) => node.paused)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(video).not.toHaveAttribute('src', /.+/);
    expect(errors).toEqual([]);
  });

  test('rechaza un video demasiado pesado y uno demasiado largo con mensajes claros', async ({ page }) => {
    const mock = await backend(page);
    await login(page);
    await expect(page.getByText('Toda historia empieza con un momento.')).toBeVisible();
    const heavy = Buffer.concat([shortVideo, Buffer.alloc(5 * 1024 * 1024)]);
    await page.locator('#photo-files').setInputFiles([
      { name: 'pesado.mp4', mimeType: 'video/mp4', buffer: heavy },
      { name: 'largo.mp4', mimeType: 'video/mp4', buffer: longVideo },
      { name: 'renombrado.mp4', mimeType: 'video/mp4', buffer: Buffer.from('<html>no soy un video</html>') },
    ]);
    await expect(page.locator('.queue-error')).toHaveCount(3);
    await expect(page.locator('.queue-error').nth(0)).toContainText('El máximo es 5 MB');
    await expect(page.locator('.queue-error').nth(1)).toContainText('El máximo es 15 segundos');
    await expect(page.locator('.queue-error').nth(2)).toContainText('estructura de un video MP4');
    await expect(page.locator('.upload-panel')).toBeHidden();
    expect(mock.uploads).toHaveLength(0);
    expect(mock.rows).toHaveLength(0);
  });
});

test.describe('organización por año, mes, lugar y tipo', () => {
  test('filtra por año, mes, lugar y tipo, y vuelve a mostrar todo', async ({ page }) => {
    await backend(page, { rows: album() });
    await login(page);
    await expect(page.locator('.photo-card')).toHaveCount(5);
    await expect(page.locator('.month-heading')).toHaveText([/Marzo de 2026/, /Febrero de 2026/, /Enero de 2026/, /Diciembre de 2025/]);
    // El recuerdo antiguo sin fecha se muestra con su fecha de subida, sin inventar otra.
    await expect(page.getByRole('article').filter({ hasText: 'Recuerdo 5.png' }).locator('time')).toHaveText(/^Subida el 20 de febrero de 2026$/);
    const year = filter(page, 'Año');
    const month = filter(page, 'Mes');
    await expect(year.locator('option')).toHaveText(['Todos los años', '2026', '2025']);
    await expect(month).toBeDisabled();
    await year.selectOption('2025');
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await expect(page.locator('.filter-summary')).toHaveText('Mostrando 1 de 5 recuerdos.');
    await year.selectOption('2026');
    await expect(page.locator('.photo-card')).toHaveCount(4);
    await expect(month.locator('option')).toHaveText(['Todos los meses', 'Enero', 'Febrero', 'Marzo']);
    await month.selectOption({ label: 'Enero' });
    await expect(page.locator('.photo-card')).toHaveCount(2);
    await expect(page.locator('.month-heading')).toHaveText([/Enero de 2026/]);
    await filter(page, 'Tipo').selectOption('video');
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await expect(page.locator('.photo-card.is-video')).toHaveCount(1);
    await page.getByRole('button', { name: 'Ver todos' }).click();
    await expect(page.locator('.photo-card')).toHaveCount(5);
    await filter(page, 'Lugar').selectOption('Paracas');
    await expect(page.locator('.photo-card')).toHaveCount(2);
    await filter(page, 'Lugar').selectOption({ label: 'Sin lugar' });
    await expect(page.locator('.photo-card')).toHaveCount(1);
    await filter(page, 'Tipo').selectOption('video');
    await expect(page.getByText('No hay recuerdos con estos filtros.')).toBeVisible();
    await page.getByRole('button', { name: 'Ver todos los recuerdos' }).click();
    await expect(page.locator('.photo-card')).toHaveCount(5);
  });

  test('edita la fecha y el lugar de un recuerdo y la galería se reorganiza', async ({ page }) => {
    const mock = await backend(page, { rows: album() });
    await login(page);
    await page.getByRole('button', { name: 'Editar fecha y lugar de Recuerdo 5.png' }).click();
    const dialog = page.getByRole('dialog', { name: 'Fecha y lugar del recuerdo' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Fecha del recuerdo', { exact: true }).fill('2024-07-15');
    await dialog.getByLabel('Lugar', { exact: true }).fill('  Nuestro viaje ');
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(dialog).toBeHidden();
    expect(mock.patches).toEqual([{ changes: { memory_date: '2024-07-15', place: 'Nuestro viaje' }, account: USER_ID }]);
    await expect(page.locator('.month-heading').last()).toContainText('Julio de 2024');
    const card = page.getByRole('article').filter({ hasText: 'Recuerdo 5.png' });
    await expect(card.locator('.photo-place')).toHaveText('Nuestro viaje');
    await expect(card.locator('time')).toHaveText('15 de julio de 2024');
    await filter(page, 'Lugar').selectOption('Nuestro viaje');
    await expect(page.locator('.photo-card')).toHaveCount(1);
    // También desde la vista ampliada.
    await page.getByRole('button', { name: 'Ampliar Recuerdo 5.png' }).click();
    await page.locator('.lightbox').getByRole('button', { name: 'Editar fecha y lugar' }).click();
    await dialog.getByLabel('Lugar', { exact: true }).fill('Casa');
    await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(dialog).toBeHidden();
    expect(mock.patches.at(-1).changes).toEqual({ memory_date: '2024-07-15', place: 'Casa' });
  });

  test('si Supabase no permite editar, avisa sin cambiar el recuerdo', async ({ page }) => {
    await backend(page, { rows: album(), denyUpdates: true });
    await login(page);
    await page.getByRole('button', { name: 'Editar fecha y lugar de Recuerdo 1.png' }).click();
    await page.getByRole('dialog').getByLabel('Lugar', { exact: true }).fill('Otro lugar');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('no permitió guardar');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('article').filter({ hasText: 'Recuerdo 1.png' }).locator('.photo-place')).toHaveText('Casa');
  });
});

test.describe('MIX DE RECUERDOS', () => {
  test('inicia, avanza, retrocede, pausa, reanuda y cierra usando archivos optimizados', async ({ page }) => {
    const errors = watchErrors(page);
    const mock = await backend(page, { rows: album() });
    await login(page);
    await expect(page.locator('.photo-card')).toHaveCount(5);
    const requestsBefore = mock.requests.length;
    await page.getByRole('button', { name: 'MIX DE RECUERDOS' }).click();
    const mix = page.getByRole('dialog', { name: 'Mix de recuerdos' });
    await expect(mix).toBeVisible();
    await expect(mix.locator('.mix-slide.is-active h2')).toHaveText('Nuestros recuerdos de diciembre de 2025');
    await expect(mix.locator('.mix-counter')).toHaveText('1 / 9');
    await mix.getByRole('button', { name: 'Recuerdo siguiente' }).click();
    await expect(mix.locator('.mix-counter')).toHaveText('2 / 9');
    await expect(mix.locator('.mix-slide.is-active img.mix-media')).toHaveAttribute('src', /\/display\//);
    await expect(mix.locator('.mix-slide.is-active .mix-place')).toHaveText('Casa');
    await mix.getByRole('button', { name: 'Recuerdo anterior' }).click();
    await expect(mix.locator('.mix-counter')).toHaveText('1 / 9');
    await mix.getByRole('button', { name: 'Pausar presentación' }).click();
    const resume = mix.getByRole('button', { name: 'Reanudar presentación' });
    await expect(resume).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(3200); // Más que la duración de un título: no debe avanzar en pausa.
    await expect(mix.locator('.mix-counter')).toHaveText('1 / 9');
    await resume.click();
    await expect(mix.locator('.mix-counter')).toHaveText('2 / 9', { timeout: 5000 });
    // Teclado: flechas para avanzar hasta el video.
    await mix.locator('.mix-counter').click();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(mix.locator('.mix-counter')).toHaveText('5 / 9');
    await expect(mix.locator('.mix-slide.is-active video')).toHaveCount(1);
    expect(await mix.locator('video').count()).toBeLessThanOrEqual(1);
    await expect.poll(() => mix.locator('.mix-slide.is-active video').evaluate((node) => node.muted)).toBe(true);
    await mix.getByRole('button', { name: 'Cerrar presentación' }).click();
    await expect(mix).toBeHidden();
    await expect(page.locator('.photo-card')).toHaveCount(5);
    // Las fotos del MIX nunca descargaron originales.
    const after = mock.requests.slice(requestsBefore).filter((request) => request.method === 'GET' && request.path.includes('/originals/') && request.path.endsWith('.png'));
    expect(after).toHaveLength(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'neutral');
    expect(errors).toEqual([]);
  });

  test('con menos de dos recuerdos muestra un mensaje amigable y no inventa contenido', async ({ page }) => {
    await backend(page, { rows: [memory(1, '2026-01-01')] });
    await login(page);
    await page.getByRole('button', { name: 'MIX DE RECUERDOS' }).click();
    await expect(page.locator('.notice')).toContainText('Aún no hay suficientes recuerdos para un mix');
    await expect(page.locator('.mix')).toBeHidden();
  });

  test('el MIX es usable en un celular', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await backend(page, { rows: album() });
    await login(page);
    await page.getByRole('button', { name: 'MIX DE RECUERDOS' }).click();
    const mix = page.getByRole('dialog', { name: 'Mix de recuerdos' });
    await expect(mix).toBeVisible();
    for (const name of ['Recuerdo anterior', 'Pausar presentación', 'Recuerdo siguiente', 'Cerrar presentación']) await expect(mix.getByRole('button', { name })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(mix).toBeHidden();
  });
});

test.describe('álbum compartido y acceso', () => {
  test('ambas cuentas ven los mismos recuerdos, conservan su tema y pueden eliminar los del otro', async ({ browser }) => {
    const shared = createState({ rows: album().map((row) => ({ ...row, uploaded_by: accounts.el.id })) });
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    try {
      const [el, ella] = await Promise.all(contexts.map((context) => context.newPage()));
      await backend(el, { shared, account: accounts.el });
      await backend(ella, { shared, account: accounts.ella });
      await login(el, accounts.el);
      await login(ella, accounts.ella);
      await expect(el.locator('.photo-card')).toHaveCount(5);
      await expect(ella.locator('.photo-card')).toHaveCount(5);
      const names = async (page) => page.locator('.photo-description h3').allTextContents();
      expect(await names(el)).toEqual(await names(ella));
      await expect(el.locator('html')).toHaveAttribute('data-theme', 'blue');
      await expect(ella.locator('html')).toHaveAttribute('data-theme', 'rose');
      const target = { ...shared.rows.find((row) => row.id === id(4)) };
      // Ella elimina un recuerdo subido por él: se borran original, miniatura y versión optimizada.
      await ella.getByRole('button', { name: 'Eliminar Recuerdo 4.png' }).click();
      await ella.getByRole('button', { name: 'Sí, eliminar' }).click();
      await expect(ella.locator('.photo-card')).toHaveCount(4);
      expect(shared.deletedPaths).toEqual([target.storage_path, target.thumbnail_path, target.display_path]);
      await el.getByRole('button', { name: 'Actualizar' }).click();
      await expect(el.locator('.photo-card')).toHaveCount(4);
      await expect(el.locator('html')).toHaveAttribute('data-theme', 'blue');
    } finally { await Promise.all(contexts.map((context) => context.close())); }
  });

  test('sin sesión o sin membresía no se consulta ni se firma nada del almacenamiento', async ({ page }) => {
    const anonymous = await backend(page, { rows: album() });
    await page.goto('./');
    await expect(page.locator('.auth-page')).toBeVisible();
    expect(anonymous.requests.filter((request) => /storage|album_photos/.test(request.path))).toHaveLength(0);
    const other = await page.context().newPage();
    const stranger = await backend(other, { rows: album(), nonMember: true });
    await login(other);
    await expect(other.getByText('Esta cuenta no pertenece al álbum.', { exact: false })).toBeVisible();
    expect(stranger.requests.filter((request) => /storage|album_photos/.test(request.path))).toHaveLength(0);
    // Toda imagen del álbum se pide mediante URL firmada, nunca por la ruta pública del bucket.
    const member = await backend(await page.context().newPage(), { rows: album() });
    expect(member.requests.some((request) => request.path.includes('/object/public/'))).toBe(false);
  });
});
