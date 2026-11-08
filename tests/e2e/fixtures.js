import { readFileSync } from 'node:fs';
import { USER_ID, examplePhoto } from '../unit/helpers.js';
import { userThemes } from '../../src/config/userThemes.js';

// Todos los usuarios, contraseñas y tokens de este archivo son fixtures ficticios.
// TODAS las peticiones a Supabase y a Cloudflare se interceptan; nunca toca servicios reales.
const ORIGIN = 'https://ycomlinemyhlwjaklxju.supabase.co';
const TURNSTILE = 'https://challenges.cloudflare.com';
export const CAPTCHA_TOKEN = 'E2E_TURNSTILE_TOKEN_NO_REAL';
export const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'prueba@example.invalid', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
// Las dos cuentas del álbum usan los UUID públicos de userThemes.js para verificar sus temas.
const themed = (theme) => Object.keys(userThemes).find((id) => userThemes[id] === theme);
export const accounts = {
  el: { ...user, id: themed('blue'), email: 'el@example.invalid' },
  ella: { ...user, id: themed('rose'), email: 'ella@example.invalid' },
};
export const shortVideo = readFileSync(new URL('../fixtures/recuerdo-corto.mp4', import.meta.url));
export const longVideo = readFileSync(new URL('../fixtures/recuerdo-largo.mp4', import.meta.url));

export function tokenData(account = user) {
  const encode = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.E2E_NOT_A_REAL_SIGNATURE`, refresh_token: 'E2E_NOT_A_REAL_REFRESH_TOKEN', token_type: 'bearer', expires_in: 3600, user: account };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

// Simulación de la API de Turnstile. Modos: pass (resuelve), fail (error), expire (resuelve y vence), unavailable (no carga).
function turnstileScript(mode) {
  return `(() => {
    const widgets = [];
    const solve = (widget) => setTimeout(() => {
      if (${JSON.stringify(mode)} === 'fail') { widget.options['error-callback']?.('300030'); return; }
      widget.options.callback?.(${JSON.stringify(CAPTCHA_TOKEN)} + '_' + (++widget.count));
      if (${JSON.stringify(mode)} === 'expire' && widget.count === 1) setTimeout(() => widget.options['expired-callback']?.(), 50);
    }, 30);
    window.__turnstile = { renders: 0, resets: 0, lastOptions: null };
    window.turnstile = {
      render(container, options) {
        const widget = { options, count: 0 };
        widgets.push(widget);
        window.__turnstile.renders++;
        window.__turnstile.lastOptions = { sitekey: options.sitekey, action: options.action };
        const box = document.createElement('div');
        box.className = 'fake-turnstile';
        box.textContent = 'Verificación simulada';
        container.append(box);
        solve(widget);
        return String(widgets.length - 1);
      },
      reset(id) { window.__turnstile.resets++; solve(widgets[Number(id)]); },
      remove() {},
    };
  })();`;
}

export function createState(options = {}) {
  return { rows: options.rows || (options.photos ? [{ ...examplePhoto }] : []), uploads: [], uploadTypes: [], deletes: [], requests: [], patches: [], captchaTokens: [], metadataDeleteFailures: options.metadataDeleteFailures || 0 };
}

export async function backend(page, options = {}) {
  const state = options.shared || createState(options);
  const imageBody = options.imageBody || png;
  const account = options.account || user;
  let captchaRejections = options.captchaRejections || 0;
  await page.route(`${TURNSTILE}/**`, (route) => {
    if (options.captcha === 'unavailable') return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: turnstileScript(options.captcha || 'pass') });
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    state.requests.push({ path: url.pathname, method, query: url.search, account: account.id });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        const body = request.postDataJSON();
        const token = body.gotrue_meta_security?.captcha_token;
        state.captchaTokens.push(token ?? null);
        // Igual que Supabase con CAPTCHA activo: sin token válido no hay sesión.
        if (!token || !token.startsWith(CAPTCHA_TOKEN)) return json({ code: 'captcha_failed', msg: 'captcha protection: request disallowed (no captcha response)' }, 400);
        if (captchaRejections > 0) { captchaRejections--; return json({ code: 'captcha_failed', msg: 'captcha protection: request disallowed (timeout-or-duplicate)' }, 400); }
      }
      if (options.invalidLogin) return json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return json(tokenData(account));
    }
    if (url.pathname === '/auth/v1/user') return json(account);
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname === '/auth/v1/recover') {
      state.recoveryRedirect = url.searchParams.get('redirect_to');
      state.recoveryCaptcha = request.postDataJSON().gotrue_meta_security?.captcha_token;
      return json({});
    }
    if (url.pathname === '/rest/v1/album_members') return json(options.nonMember ? [] : [{ user_id: account.id }]);
    if (url.pathname === '/rest/v1/album_photos') {
      const select = url.searchParams.get('select') || '';
      if (options.legacySchema && /media_type|memory_date|display_path/.test(select)) return json({ code: '42703', message: 'column album_photos.media_type does not exist' }, 400);
      if (method === 'POST') {
        const photo = request.postDataJSON();
        state.rows.unshift(photo);
        return json(photo, 201);
      }
      let rows = state.rows.filter((row) => [...url.searchParams].every(([key, filter]) => {
        if (filter.startsWith('eq.')) return row[key] === filter.slice(3);
        if (filter.startsWith('neq.')) return row[key] !== filter.slice(4);
        if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').map((part) => part.replaceAll('"', '')).includes(row[key]);
        return true;
      }));
      if (method === 'PATCH') {
        const changes = request.postDataJSON();
        state.patches.push({ changes, account: account.id });
        if (options.denyUpdates) return json([]);
        for (const row of rows) Object.assign(row, changes);
        return json(rows);
      }
      if (method === 'DELETE') {
        state.deletes.push('metadata');
        if (state.metadataDeleteFailures > 0) { state.metadataDeleteFailures--; return json({ message: 'permission denied', code: '42501' }, 403); }
        state.rows = state.rows.filter((row) => !rows.includes(row));
      }
      return json(rows);
    }
    if (url.pathname === '/storage/v1/object/sign/recuerdos' && method === 'POST') {
      const { paths } = request.postDataJSON();
      return json(paths.map((path) => options.missingThumbnail && path.startsWith('thumbnails/')
        ? { path, error: 'Object not found', signedURL: null }
        : { path, error: null, signedURL: `/object/sign/recuerdos/${path}?token=E2E_ONLY` }));
    }
    if (url.pathname.startsWith('/storage/v1/object/sign/recuerdos/') && method === 'GET') {
      if (url.pathname.endsWith('.mp4')) return route.fulfill({ contentType: 'video/mp4', body: options.videoBody || shortVideo, headers: { 'Accept-Ranges': 'none' } });
      return route.fulfill({ contentType: 'image/png', body: imageBody });
    }
    if (url.pathname === '/storage/v1/object/recuerdos' && method === 'DELETE') {
      const { prefixes } = request.postDataJSON();
      state.deletes.push('storage');
      state.deletedPaths = [...(state.deletedPaths || []), ...prefixes];
      return json(prefixes.map((name) => ({ name })));
    }
    if (url.pathname.startsWith('/storage/v1/object/recuerdos/') && method === 'POST') {
      state.uploads.push(url.pathname);
      // supabase-js envía Blob/File como multipart: el tipo real va en la cabecera de la parte.
      const part = /content-type:\s*([^\r\n;]+)/gi;
      const types = [...(request.postDataBuffer() || Buffer.alloc(0)).toString('latin1').matchAll(part)].map((match) => match[1].trim().toLowerCase());
      state.uploadTypes.push(types.at(-1) || request.headers()['content-type'] || '');
      return json({ Key: url.pathname.replace('/storage/v1/object/', ''), Id: crypto.randomUUID() });
    }
    if (method === 'HEAD') return route.fulfill({ status: 404 });
    throw new Error(`Petición sin fixture: ${method} ${url.pathname}`);
  });
  return state;
}

export async function login(page, account = user) {
  await page.goto('./');
  await page.getByLabel('Tu correo electrónico').fill(account.email);
  await page.getByLabel('Tu contraseña', { exact: true }).fill('SOLO_PRUEBA_NO_ES_REAL');
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

export async function fixtureImage(page, width = 1200, height = 800) {
  const image = await page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#b1c6cb');
    gradient.addColorStop(1, '#edcfaa');
    context.fillStyle = gradient;
    context.fillRect(0, 0, w, h);
    context.fillStyle = '#fff2cf';
    context.beginPath();
    context.arc(w * 0.7, h * 0.28, Math.min(w, h) * 0.1, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#658776';
    context.beginPath();
    context.moveTo(0, h * 0.6);
    context.lineTo(w * 0.35, h * 0.42);
    context.lineTo(w, h * 0.75);
    context.lineTo(w, h);
    context.lineTo(0, h);
    context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }, [width, height]);
  return Buffer.from(image, 'base64');
}
