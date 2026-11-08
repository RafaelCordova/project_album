import { AlbumError } from '../utils/errors.js';
import { validateImageSignature, createImageVariants, createVideoPoster } from './imageService.js';
import { validateVideo, VIDEO_MIME } from './videoService.js';
import { assertStoragePath } from './storageService.js';
import { normalizePlace, parseMemoryDate } from './memories.js';

// Columnas originales (esquema v1). Siguen siendo la base de compatibilidad.
export const PHOTO_COLUMNS = 'id,storage_path,thumbnail_path,original_name,uploaded_by,created_at';
// Columnas añadidas por supabase/migrations/20261106_recuerdos_v2.sql.
export const MEMORY_EXTRA_COLUMNS = 'media_type,memory_date,place,display_path,duration_seconds';
export const MEMORY_COLUMNS = `${PHOTO_COLUMNS},${MEMORY_EXTRA_COLUMNS}`;
export const PAGE_SIZE = 48; // Tarjetas que se muestran por tanda en la galería.
const FETCH_SIZE = 500; // Filas de metadatos por consulta (PostgREST limita a 1000 por defecto).
const MAX_ROWS = 10_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST responde 42703 (o PGRST204) cuando una columna aún no existe.
export function isMissingColumn(error) {
  return ['42703', 'PGRST204'].includes(error?.code) || /column .* does not exist|could not find the .* column/i.test(error?.message || '');
}

// Las filas v1 se completan con valores neutros: siguen siendo fotografías sin fecha ni lugar.
function normalizeRow(row) {
  if (!row) return row;
  return { media_type: 'photo', memory_date: null, place: null, display_path: null, duration_seconds: null, ...row };
}

export function createPhotoService(client, storage, { thumbnail, variants = createImageVariants, poster = createVideoPoster, inspectVideo = validateVideo } = {}) {
  // Compatibilidad: una función `thumbnail` heredada genera solo la miniatura.
  const makeVariants = thumbnail ? async (file) => ({ thumbnail: await thumbnail(file), display: null }) : variants;
  let schema = null; // 'v1' | 'v2'

  const columns = () => (schema === 'v1' ? PHOTO_COLUMNS : MEMORY_COLUMNS);

  async function detectSchema() {
    if (schema) return schema;
    const { error } = await client.from('album_photos').select(MEMORY_COLUMNS).limit(1);
    if (error && !isMissingColumn(error)) throw error;
    schema = error ? 'v1' : 'v2';
    return schema;
  }

  async function getPhoto(id) {
    if (!uuidPattern.test(id)) throw new AlbumError('El identificador del recuerdo no es válido.');
    await detectSchema();
    const { data, error } = await client.from('album_photos').select(columns()).eq('id', id).maybeSingle();
    if (error) throw error;
    return normalizeRow(data);
  }

  return {
    get schema() { return schema; },
    detectSchema,
    // Lee todos los metadatos (son pocos bytes por fila) para filtrar y agrupar en el cliente.
    // Las imágenes NO se descargan aquí: solo se firman las miniaturas visibles.
    async list() {
      await detectSchema();
      const rows = [];
      for (let offset = 0; offset < MAX_ROWS; offset += FETCH_SIZE) {
        const { data, error } = await client.from('album_photos').select(columns())
          .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(offset, offset + FETCH_SIZE - 1);
        if (error) throw error;
        rows.push(...(data || []).map(normalizeRow));
        if (!data || data.length < FETCH_SIZE) break;
      }
      return [...new Map(rows.map((row) => [row.id, row])).values()];
    },
    async upload(file, onStage = () => {}, details = {}) {
      const isVideo = file.type === VIDEO_MIME;
      let duration = null;
      if (isVideo) ({ duration } = await inspectVideo(file));
      else await validateImageSignature(file);
      // Si no se puede leer el esquema (p. ej. sin red), una foto sin datos extra se sube con las columnas clásicas.
      let detected = null;
      let detectionError = null;
      try { detected = await detectSchema(); } catch (error) { detectionError = error; }
      const v2 = detected === 'v2';
      const wantsDetails = Boolean(String(details.memoryDate || '').trim() || normalizePlace(details.place));
      if (!detected && (isVideo || wantsDetails)) throw detectionError;
      if (isVideo && !v2) throw new AlbumError('Para guardar videos falta aplicar la migración de Supabase descrita en docs/MEJORAS.md.');
      const memoryDate = v2 ? parseDetailsDate(details.memoryDate) : null;
      const place = v2 ? normalizePlace(details.place) || null : null;
      const { data: { user }, error } = await client.auth.getUser();
      if (error) throw error;
      if (!user || !uuidPattern.test(user.id)) throw new AlbumError('Inicia sesión de nuevo antes de subir recuerdos.');
      const id = crypto.randomUUID();
      const extension = isVideo ? 'mp4' : file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
      const originalPath = `originals/${user.id}/${id}.${extension}`;
      const thumbPath = `thumbnails/${user.id}/${id}.webp`;
      const displayPath = `display/${user.id}/${id}.webp`;
      onStage(isVideo ? 'Preparando portada del video…' : 'Preparando versiones optimizadas…');
      let mini = null;
      let large = null;
      if (isVideo) mini = await poster(file);
      else ({ thumbnail: mini, display: large } = await makeVariants(file));
      // Sin columna display_path (esquema v1) no se sube una versión que no podría referenciarse.
      if (!v2) large = null;
      const attempted = [];
      async function uploadObject(path, body, contentType) {
        attempted.push(path);
        try { await storage.upload(path, body, contentType); }
        catch (error) {
          // Un conflicto nunca autoriza a limpiar el archivo que ya estaba allí.
          if (Number(error.statusCode || error.status) === 409 || error.code === 'Duplicate') attempted.pop();
          throw error;
        }
      }
      let thumbnailPath = null;
      let displayStored = null;
      let metadataAttempted = false;
      try {
        onStage(isVideo ? 'Subiendo video…' : 'Subiendo original…');
        await uploadObject(originalPath, file, file.type);
        if (mini) {
          onStage(isVideo ? 'Subiendo portada…' : 'Subiendo miniatura…');
          await uploadObject(thumbPath, mini, 'image/webp');
          thumbnailPath = thumbPath;
        }
        if (large) {
          onStage('Subiendo versión para ver en grande…');
          await uploadObject(displayPath, large, 'image/webp');
          displayStored = displayPath;
        }
        onStage('Guardando recuerdo…');
        const photo = { id, storage_path: originalPath, thumbnail_path: thumbnailPath, original_name: file.name, uploaded_by: user.id, created_at: new Date().toISOString() };
        if (v2) Object.assign(photo, { media_type: isVideo ? 'video' : 'photo', memory_date: memoryDate, place, display_path: displayStored, duration_seconds: duration });
        metadataAttempted = true;
        const result = await client.from('album_photos').insert(photo).select(v2 ? MEMORY_COLUMNS : PHOTO_COLUMNS).single();
        if (result.error) throw result.error;
        return { photo: normalizeRow(result.data), withoutThumbnail: !mini };
      } catch (cause) {
        // Un INSERT puede haberse confirmado aunque su respuesta se haya perdido.
        // Nunca borrar archivos sin verificar primero ese resultado ambiguo.
        if (metadataAttempted) {
          let committed;
          try { committed = await getPhoto(id); }
          catch {
            throw new AlbumError('No se pudo confirmar si el recuerdo se guardó. Actualiza la galería antes de repetir la subida. Los archivos se conservaron por seguridad.', { cause, details: { id, paths: attempted } });
          }
          if (committed?.storage_path === originalPath && committed.uploaded_by === user.id) return { photo: committed, withoutThumbnail: !mini };
        }
        try { await storage.remove(attempted); }
        catch {
          throw new AlbumError('La subida falló y no se pudo completar la limpieza. Revisa los archivos pendientes siguiendo docs/SEGURIDAD.md.', { cause, details: { id, paths: attempted } });
        }
        throw cause;
      }
    },
    // Solo modifica la fecha del recuerdo y el lugar. Las rutas y el autor son inmutables.
    async updateDetails(id, details = {}) {
      if (!uuidPattern.test(id)) throw new AlbumError('El identificador del recuerdo no es válido.');
      if (await detectSchema() === 'v1') throw new AlbumError('Para editar fecha y lugar falta aplicar la migración de Supabase descrita en docs/MEJORAS.md.');
      const changes = { memory_date: parseDetailsDate(details.memoryDate), place: normalizePlace(details.place) || null };
      const result = await client.from('album_photos').update(changes).eq('id', id).select(MEMORY_COLUMNS).maybeSingle();
      if (result.error) throw result.error;
      // Un UPDATE filtrado por RLS responde sin filas en lugar de un error.
      if (!result.data) throw new AlbumError('Supabase no permitió guardar los cambios. Revisa que la migración y la política de edición estén aplicadas.');
      return normalizeRow(result.data);
    },
    async remove(id) {
      // No acepta rutas desde botones ni desde el llamador: vuelve a consultar la fila protegida por RLS.
      const photo = await getPhoto(id);
      if (!photo) return;
      const paths = [...new Set([photo.storage_path, photo.thumbnail_path, photo.display_path].filter(Boolean))].map(assertStoragePath);
      // Protege referencias antiguas que pudieran compartir un archivo con otra fila.
      const referenceColumns = schema === 'v2' ? ['storage_path', 'thumbnail_path', 'display_path'] : ['storage_path', 'thumbnail_path'];
      const references = await Promise.all(referenceColumns.map((column) =>
        client.from('album_photos').select('id').in(column, paths).neq('id', id).limit(1)));
      for (const result of references) {
        if (result.error) throw result.error;
        if (result.data.length) throw new AlbumError('Este archivo está asociado a otro recuerdo. Revisa las referencias en Supabase antes de eliminarlo.');
      }
      try { await storage.remove(paths); }
      catch (cause) { throw new AlbumError('No se pudieron eliminar todos los archivos. Conservamos el registro para que puedas reintentar.', { cause }); }
      const result = await client.from('album_photos').delete().eq('id', id).eq('storage_path', photo.storage_path).select('id');
      if (result.error || !result.data?.length) {
        // Otra persona pudo haber terminado la misma eliminación de forma concurrente.
        const remaining = await getPhoto(id);
        if (remaining) throw new AlbumError('Los archivos se eliminaron, pero el registro sigue pendiente. Vuelve a eliminar este recuerdo para completar la operación.', { cause: result.error });
      }
    },
  };
}

function parseDetailsDate(value) {
  try { return parseMemoryDate(value); }
  catch (error) { throw new AlbumError(error.message); }
}
