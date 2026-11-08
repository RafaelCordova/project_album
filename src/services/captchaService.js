// Integración con Cloudflare Turnstile. El token solo se ENVÍA a Supabase Auth, que lo
// valida en su servidor con la clave secreta configurada en el panel. El navegador nunca
// decide por sí solo si la verificación es válida.
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
let loading = null;

export function loadTurnstile(win = globalThis.window, doc = globalThis.document) {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      const fail = () => { loading = null; script.remove(); reject(new Error('turnstile-load')); };
      script.addEventListener('load', () => (win.turnstile ? resolve(win.turnstile) : fail()));
      script.addEventListener('error', fail);
      doc.head.append(script);
    });
  }
  return loading;
}

/**
 * Estados: disabled | loading | pending | solved | expired | error | unavailable.
 * - pending: esperando a que la persona complete la verificación.
 * - unavailable: no se pudo cargar el widget (red, bloqueador); permite reintentar.
 */
export function createCaptcha({ siteKey, container, action = 'login', load = loadTurnstile, onChange = () => {} }) {
  let state = siteKey ? 'loading' : 'disabled';
  let token = null;
  let widget = null;
  let api = null;
  let destroyed = false;
  const set = (next, value = null) => { state = next; token = value; if (!destroyed) onChange(state); };

  async function mount() {
    if (!siteKey || destroyed) return;
    set('loading');
    try {
      api = await load();
      if (destroyed) return;
      widget = api.render(container, {
        sitekey: siteKey,
        action,
        language: 'es',
        theme: 'light',
        size: 'flexible',
        'refresh-expired': 'auto',
        callback: (value) => set('solved', typeof value === 'string' && value ? value : null),
        'expired-callback': () => set('expired'),
        'timeout-callback': () => set('expired'),
        'error-callback': () => { set('error'); return true; },
      });
      if (state === 'loading') set('pending');
    } catch { if (!destroyed) set('unavailable'); }
  }

  const controller = {
    get enabled() { return Boolean(siteKey); },
    get state() { return state; },
    // Devuelve el token solo si está resuelto; cada token es de un solo uso.
    token() { return state === 'solved' ? token : null; },
    // Tras cada intento (exitoso o no) se solicita un token nuevo.
    reset() {
      if (!siteKey || destroyed) return;
      if (widget === null || !api) { void mount(); return; }
      set('pending');
      try { api.reset(widget); } catch { set('error'); }
    },
    retry() { if (state === 'unavailable' || widget === null) void mount(); else controller.reset(); },
    destroy() {
      destroyed = true;
      try { if (api && widget !== null) api.remove(widget); } catch { /* El widget ya no existe. */ }
      widget = null;
      token = null;
    },
  };
  void mount();
  return controller;
}

export function captchaMessage(state) {
  return {
    loading: 'Cargando la verificación de seguridad…',
    pending: 'Completa la verificación de seguridad para continuar.',
    expired: 'La verificación venció. Complétala de nuevo o pulsa «Reintentar verificación».',
    error: 'La verificación de seguridad falló. Pulsa «Reintentar verificación».',
    unavailable: 'No se pudo cargar la verificación de seguridad. Revisa tu conexión o bloqueadores y pulsa «Reintentar verificación».',
  }[state] || '';
}
