import test from 'node:test';
import assert from 'node:assert/strict';
import { setPasswordVisibility, togglePasswordVisibility } from '../../src/components/passwordToggle.js';
import { captchaMessage, createCaptcha } from '../../src/services/captchaService.js';
import { readCaptchaSiteKey, readConfig } from '../../src/config/environment.js';
import { createAuthService } from '../../src/services/authService.js';
import { friendlyError } from '../../src/utils/errors.js';

function fakeToggle() {
  const attributes = {};
  return { attributes, dataset: {}, title: '', setAttribute(name, value) { attributes[name] = value; } };
}

test('mostrar y ocultar contraseña conserva el valor y actualiza el estado accesible', () => {
  const input = { type: 'password', value: 'secreto-de-prueba' };
  const toggle = fakeToggle();
  setPasswordVisibility(input, toggle, false);
  assert.equal(input.type, 'password');
  assert.equal(toggle.attributes['aria-pressed'], 'false');
  assert.equal(toggle.attributes['aria-label'], 'Mostrar contraseña');
  togglePasswordVisibility(input, toggle);
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'secreto-de-prueba');
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  assert.equal(toggle.attributes['aria-label'], 'Ocultar contraseña');
  assert.equal(toggle.dataset.visible, 'true');
  togglePasswordVisibility(input, toggle);
  assert.equal(input.type, 'password');
  assert.equal(toggle.dataset.visible, 'false');
  assert.equal(input.value, 'secreto-de-prueba');
});

function fakeTurnstile() {
  const api = { widgets: [], resets: 0, removed: 0 };
  api.render = (container, options) => { api.widgets.push(options); return 'w1'; };
  api.reset = () => { api.resets++; };
  api.remove = () => { api.removed++; };
  return api;
}

test('sin sitekey el CAPTCHA queda desactivado y no carga scripts', () => {
  let loaded = false;
  const captcha = createCaptcha({ siteKey: '', container: {}, load: async () => { loaded = true; } });
  assert.equal(captcha.enabled, false);
  assert.equal(captcha.state, 'disabled');
  assert.equal(captcha.token(), null);
  assert.equal(loaded, false);
});

test('con sitekey entrega el token solo cuando está resuelto y pide uno nuevo tras cada intento', async () => {
  const api = fakeTurnstile();
  const states = [];
  const captcha = createCaptcha({ siteKey: '1x00000000000000000000AA', container: {}, load: async () => api, onChange: (state) => states.push(state) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(api.widgets[0].sitekey, '1x00000000000000000000AA');
  assert.equal(api.widgets[0].language, 'es');
  assert.equal(captcha.state, 'pending');
  assert.equal(captcha.token(), null);
  api.widgets[0].callback('TOKEN_1');
  assert.equal(captcha.token(), 'TOKEN_1');
  captcha.reset();
  assert.equal(api.resets, 1);
  assert.equal(captcha.token(), null); // Un token usado no se reutiliza.
  api.widgets[0].callback('TOKEN_2');
  assert.equal(captcha.token(), 'TOKEN_2');
  api.widgets[0]['expired-callback']();
  assert.equal(captcha.state, 'expired');
  assert.equal(captcha.token(), null);
  assert.equal(api.widgets[0]['error-callback'](), true);
  assert.equal(captcha.state, 'error');
  assert.equal(captcha.token(), null);
  captcha.retry();
  assert.equal(api.resets, 2);
  captcha.destroy();
  assert.equal(api.removed, 1);
  assert.deepEqual(states.slice(0, 3), ['loading', 'pending', 'solved']);
});

test('si el script no carga (red o bloqueador) permite reintentar sin quedar bloqueado', async () => {
  let attempts = 0;
  const api = fakeTurnstile();
  const captcha = createCaptcha({ siteKey: '1x00000000000000000000AA', container: {}, load: async () => { attempts++; if (attempts === 1) throw new Error('offline'); return api; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captcha.state, 'unavailable');
  assert.match(captchaMessage(captcha.state), /Reintentar/);
  captcha.retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captcha.state, 'pending');
  assert.equal(attempts, 2);
});

test('el token se envía a Supabase Auth (signIn y recover) solo cuando existe', async () => {
  const calls = [];
  const client = { auth: {
    async signInWithPassword(payload) { calls.push(['signIn', payload]); return { error: null }; },
    async resetPasswordForEmail(email, options) { calls.push(['recover', email, options]); return { error: null }; },
  } };
  globalThis.window ??= { location: { origin: 'http://127.0.0.1:5173' } };
  const auth = createAuthService(client);
  await auth.signIn(' a@b.invalid ', 'x', 'TOKEN');
  await auth.signIn('a@b.invalid', 'x');
  await auth.recover('a@b.invalid', 'TOKEN_R');
  assert.deepEqual(calls[0][1], { email: 'a@b.invalid', password: 'x', options: { captchaToken: 'TOKEN' } });
  assert.deepEqual(calls[1][1], { email: 'a@b.invalid', password: 'x' });
  assert.equal(calls[2][2].captchaToken, 'TOKEN_R');
});

test('errores CAPTCHA del servidor tienen un mensaje claro', () => {
  assert.match(friendlyError({ message: 'captcha protection: request disallowed (timeout-or-duplicate)' }), /verificación de seguridad/);
  assert.match(friendlyError({ code: 'captcha_failed', message: '' }), /verificación de seguridad/);
});

test('la sitekey es opcional y se rechaza una clave secreta de Turnstile', () => {
  assert.equal(readCaptchaSiteKey({}), '');
  assert.equal(readCaptchaSiteKey({ VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAAB_TEST_ONLY_x' }), '0x4AAAAAAAB_TEST_ONLY_x');
  assert.throws(() => readCaptchaSiteKey({ VITE_TURNSTILE_SITE_KEY: '1x0000000000000000000000000000000AA' }), /clave secreta/);
  assert.throws(() => readCaptchaSiteKey({ VITE_TURNSTILE_SITE_KEY: 'no-es-una-clave' }), /formato/);
  const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TEST_ONLY', VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' };
  assert.equal(readConfig(env).captchaSiteKey, '1x00000000000000000000AA');
  assert.equal(readConfig({ ...env, VITE_TURNSTILE_SITE_KEY: '' }).captchaSiteKey, '');
});
