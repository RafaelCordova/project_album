// Comprobación ANÓNIMA y de SOLO LECTURA contra el Supabase configurado en .env.local.
// Simula a un visitante sin sesión: no inicia sesión, no sube, no edita y no borra nada.
// Uso manual del propietario: npm run check:remote
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { readConfig } from '../src/config/environment.js';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))) };
const config = readConfig(env);
if (!config.ready) { console.error('Falta la configuración pública en .env.local.'); process.exit(1); }
const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const results = [];
const check = (name, passed, detail = '') => results.push({ name, passed, detail });

for (const table of ['album_photos', 'album_members']) {
  const { data, error } = await client.from(table).select('*').limit(1);
  check(`Sin sesión no se leen filas de ${table}`, Boolean(error) || data.length === 0, error ? `denegado (${error.code || error.message})` : `${data.length} filas`);
}
const bucket = client.storage.from('recuerdos');
for (const prefix of ['', 'originals', 'thumbnails', 'display']) {
  const { data, error } = await bucket.list(prefix, { limit: 1 });
  check(`Sin sesión no se listan archivos en "${prefix || '/'}"`, Boolean(error) || data.length === 0, error ? 'denegado' : `${data.length} elementos`);
}
const fake = 'originals/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.jpg';
const signed = await bucket.createSignedUrl(fake, 60);
check('Sin sesión no se pueden firmar URLs', Boolean(signed.error), signed.error ? 'denegado' : 'se firmó una URL');
const publicResponse = await fetch(`${config.url}/storage/v1/object/public/recuerdos/${fake}`);
check('La ruta pública del bucket no sirve archivos', publicResponse.status >= 400, `HTTP ${publicResponse.status}`);
const info = await client.storage.getBucket('recuerdos');
check('Sin sesión no se consulta la configuración del bucket', Boolean(info.error) || info.data?.public === false, info.error ? 'denegado' : `public=${info.data?.public}`);

for (const result of results) console.log(`${result.passed ? '✔' : '✖'} ${result.name} — ${result.detail}`);
console.log('\nEsto NO prueba a una cuenta autenticada sin membresía ni a los miembros. Completa docs/MEJORAS.md §6.');
if (results.some((result) => !result.passed)) process.exitCode = 1;
