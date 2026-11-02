import { defineConfig, loadEnv } from 'vite';
import { readConfig } from './src/config/environment.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))) };
  const allowed = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_BASE_PATH']);
  for (const key of Object.keys(env)) if (!allowed.has(key)) throw new Error(`Variable pública no prevista: ${key}. Revisa que no sea un secreto.`);
  const config = readConfig(env); // Impide compilar claves secretas o JWT con privilegios.
  const base = env.VITE_BASE_PATH || '/';
  if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(base)) throw new Error('VITE_BASE_PATH debe ser / o /nombre-del-repositorio/.');
  const origin = config.ready ? config.url : 'https://ycomlinemyhlwjaklxju.supabase.co';
  return {
    base,
    build: { outDir: 'dist', sourcemap: false },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    plugins: [{
      name: 'album-csp',
      transformIndexHtml(html, context) {
        const output = html.replaceAll('__SUPABASE_ORIGIN__', origin);
        // Solo desarrollo: permite la conexión de Vite al loopback para HMR.
        return context.server ? output.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:* ws://localhost:*") : output;
      },
    }],
  };
});
