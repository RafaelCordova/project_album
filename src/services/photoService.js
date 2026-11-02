import { AlbumError } from '../utils/errors.js';
import { validateImageSignature, createThumbnail } from './imageService.js';
import { assertStoragePath } from './storageService.js';

export const PHOTO_COLUMNS = 'id,storage_path,thumbnail_path,original_name,uploaded_by,created_at';
export const PAGE_SIZE = 48;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPhotoService(client, storage, { thumbnail = createThumbnail } = {}) {
  async function getPhoto(id) {
    if (!uuidPattern.test(id)) throw new AlbumError('El identificador de la fotografía no es válido.');
    const { data, error } = await client.from('album_photos').select(PHOTO_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }
  return {
    async list(offset = 0) {
      const { data, error } = await client.from('album_photos').select(PHOTO_COLUMNS)
        .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      return data;
    },
    async upload(file, onStage = () => {}) {
      await validateImageSignature(file);
      const { data: { user }, error } = await client.auth.getUser();
      if (error) throw error;
      if (!user || !uuidPattern.test(user.id)) throw new AlbumError('Inicia sesión de nuevo antes de subir fotografías.');
      const id = crypto.randomUUID();
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
      const originalPath = `originals/${user.id}/${id}.${extension}`;
      const thumbPath = `thumbnails/${user.id}/${id}.webp`;
      onStage('Preparando miniatura…');
      const mini = await thumbnail(file);
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
      let metadataAttempted = false;
      try {
        onStage('Subiendo original…');
        await uploadObject(originalPath, file, file.type);
        if (mini) {
          onStage('Subiendo miniatura…');
          await uploadObject(thumbPath, mini, 'image/webp');
          thumbnailPath = thumbPath;
        }
        onStage('Guardando recuerdo…');
        const photo = { id, storage_path: originalPath, thumbnail_path: thumbnailPath, original_name: file.name, uploaded_by: user.id, created_at: new Date().toISOString() };
        metadataAttempted = true;
        const result = await client.from('album_photos').insert(photo).select(PHOTO_COLUMNS).single();
        if (result.error) throw result.error;
        return { photo: result.data, withoutThumbnail: !mini };
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
    async remove(id) {
      // No acepta rutas desde botones ni desde el llamador: vuelve a consultar la fila protegida por RLS.
      const photo = await getPhoto(id);
      if (!photo) return;
      const paths = [...new Set([photo.storage_path, photo.thumbnail_path].filter(Boolean))].map(assertStoragePath);
      // Protege referencias antiguas que pudieran compartir un archivo con otra fila.
      const references = await Promise.all(['storage_path', 'thumbnail_path'].map((column) =>
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
