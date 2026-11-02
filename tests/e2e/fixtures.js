import { USER_ID, examplePhoto } from '../unit/helpers.js';

// Todos los usuarios, contraseñas y tokens de este archivo son fixtures ficticios.
// TODAS las peticiones a Supabase se interceptan; nunca toca el proyecto remoto.
const ORIGIN = 'https://ycomlinemyhlwjaklxju.supabase.co';
export const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'prueba@example.invalid', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
export function tokenData() {
  const encode = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.E2E_NOT_A_REAL_SIGNATURE`, refresh_token: 'E2E_NOT_A_REAL_REFRESH_TOKEN', token_type: 'bearer', expires_in: 3600, user };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');

export async function backend(page, options = {}) {
  const state = { rows: options.rows || (options.photos ? [{ ...examplePhoto }] : []), imageBody: options.imageBody || png, uploads: [], deletes: [], requests: [], metadataDeleteFailures: options.metadataDeleteFailures || 0 };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    state.requests.push({ path: url.pathname, method, query: url.search });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') {
      if (options.invalidLogin) return json({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return json(tokenData());
    }
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname === '/auth/v1/recover') { state.recoveryRedirect = url.searchParams.get('redirect_to'); return json({}); }
    if (url.pathname === '/rest/v1/album_members') return json(options.nonMember ? [] : [{ user_id: USER_ID }]);
    if (url.pathname === '/rest/v1/album_photos') {
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
    if (url.pathname.startsWith('/storage/v1/object/sign/recuerdos/') && method === 'GET') return route.fulfill({ contentType: 'image/png', body: state.imageBody });
    if (url.pathname === '/storage/v1/object/recuerdos' && method === 'DELETE') {
      const { prefixes } = request.postDataJSON();
      state.deletes.push('storage');
      return json(prefixes.map((name) => ({ name })));
    }
    if (url.pathname.startsWith('/storage/v1/object/recuerdos/') && method === 'POST') {
      state.uploads.push(url.pathname);
      return json({ Key: url.pathname.replace('/storage/v1/object/', ''), Id: crypto.randomUUID() });
    }
    if (method === 'HEAD') return route.fulfill({ status: 404 });
    throw new Error(`Petición sin fixture: ${method} ${url.pathname}`);
  });
  return state;
}

export async function login(page) {
  await page.goto('./');
  await page.getByLabel('Tu correo electrónico').fill(user.email);
  await page.getByLabel('Tu contraseña', { exact: true }).fill('SOLO_PRUEBA_NO_ES_REAL');
  await page.getByRole('button', { name: 'Entrar a nuestro álbum' }).click();
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

