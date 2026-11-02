import { AlbumError } from '../utils/errors.js';

export const BUCKET = 'recuerdos';
export const SIGNED_URL_SECONDS = 300;

export function assertStoragePath(path) {
  if (typeof path !== 'string' || !path.trim() || path.length > 1024 || /[\\%\u0000-\u001f\u007f?#:]/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new AlbumError('La ruta guardada no es segura. Revisa este registro en Supabase antes de continuar.');
  }
  return path;
}

export function createStorageService(client) {
  const bucket = client.storage.from(BUCKET);
  const signed = new Map();
  let generation = 0;
  return {
    clear() { generation++; signed.clear(); },
    forget(paths) { for (const path of paths) signed.delete(path); },
    async upload(path, file, contentType) {
      assertStoragePath(path);
      const { error } = await bucket.upload(path, file, { contentType, cacheControl: '60', upsert: false });
      if (error) throw error;
    },
    async remove(paths) {
      const unique = [...new Set(paths.filter(Boolean))].map(assertStoragePath);
      if (!unique.length) return;
      const { data, error } = await bucket.remove(unique);
      if (error) throw error;
      // DELETE puede devolver éxito con menos objetos si una política filtra filas.
      // Solo damos por terminada la eliminación cuando cada ruta fue eliminada o ya no existe.
      const removed = new Set((data || []).map((item) => item.name));
      for (const path of unique.filter((item) => !removed.has(item))) {
        const result = await bucket.exists(path);
        const status = Number(result.error?.statusCode || result.error?.status || result.error?.originalError?.status);
        if (result.data || (result.error && status !== 404)) throw new AlbumError('Storage no confirmó la eliminación. Revisa los permisos SELECT y DELETE antes de reintentar.');
      }
      for (const path of unique) signed.delete(path);
    },
    async urls(paths, { force = false } = {}) {
      const unique = [...new Set(paths.filter(Boolean))].map(assertStoragePath);
      const needed = unique.filter((path) => force || !signed.has(path) || signed.get(path).expires <= Date.now() + 45_000);
      const requestGeneration = generation;
      for (let i = 0; i < needed.length; i += 100) {
        const group = needed.slice(i, i + 100);
        const started = Date.now();
        const { data, error } = await bucket.createSignedUrls(group, SIGNED_URL_SECONDS);
        if (error) throw error;
        if (generation !== requestGeneration) return new Map();
        for (const path of group) signed.delete(path);
        for (const item of data || []) {
          if (!group.includes(item.path)) continue;
          if (item.signedUrl && !item.error) {
            const url = new URL(item.signedUrl);
            if (url.protocol !== 'https:' || url.origin !== new URL(client.supabaseUrl).origin) continue;
            signed.set(item.path, { url: item.signedUrl, expires: started + SIGNED_URL_SECONDS * 1000 });
          } else signed.delete(item.path);
        }
      }
      return new Map(unique.map((path) => [path, signed.get(path)?.url || null]));
    },
  };
}
