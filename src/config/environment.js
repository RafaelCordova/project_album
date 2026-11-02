export function readConfig(env) {
  const url = (env.VITE_SUPABASE_URL || '').trim();
  const publicKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const anonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
  const key = publicKey || anonKey;
  // Vite incorpora import.meta.env completo: también se comprueba la alternativa no seleccionada.
  for (const candidate of [publicKey, anonKey]) {
    if (candidate.startsWith('sb_secret_')) throw new Error('Una clave secreta no puede utilizarse en el frontend.');
    if (candidate.startsWith('eyJ')) {
      let role;
      try { role = JSON.parse(atob(candidate.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; }
      catch { throw new Error('La clave JWT configurada no es válida. Usa la clave publicable o anon.'); }
      if (role !== 'anon') throw new Error('Solo se permite la clave JWT heredada con rol anon.');
    } else if (candidate && !candidate.startsWith('sb_publishable_') && !candidate.includes('COPIA_AQUI')) {
      throw new Error('Configura una clave publicable de Supabase o la clave heredada anon.');
    }
  }
  if (!url || !key || key.includes('COPIA_AQUI')) return { ready: false, message: 'Completa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local y reinicia Vite.' };
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('VITE_SUPABASE_URL no es una URL válida.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('La URL de Supabase debe ser un origen HTTPS sin credenciales, ruta ni parámetros.');
  }
  return { ready: true, url: parsed.origin, key };
}
