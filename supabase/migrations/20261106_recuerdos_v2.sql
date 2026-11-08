-- PASO 1 DE 2 — MIGRACIÓN v2 DE ESQUEMA Y BUCKET DE "NUESTRO ÁLBUM".
-- Ejecución MANUAL por el propietario en Supabase → SQL Editor. NO se ejecuta automáticamente.
-- Después de este archivo ejecuta el PASO 2: supabase/proposed-policies.sql (permisos y RLS).
-- Verificación: supabase/verify-v2.sql. Informe: docs/SQL_V2_AUDIT.md.
--
-- Qué hace (solo cambios aditivos):
--   * Añade 5 columnas a public.album_photos con valores neutros para las filas existentes.
--   * Añade restricciones CHECK coherentes con src/services/photoService.js y videoService.js.
--   * Añade un índice único parcial sobre display_path.
--   * Añade video/mp4 a los tipos MIME del bucket privado "recuerdos" (no cambia su límite ni su privacidad).
--
-- Qué NO hace:
--   * No borra ni modifica filas, archivos, usuarios, membresías ni UUID.
--   * No cambia permisos ni políticas (eso es el PASO 2).
--   * No hace público el bucket: si lo encuentra público, se detiene.
--
-- Idempotente: cada objeto se crea solo si no existe (columnas, constraints por nombre, índice) y el
-- UPDATE del bucket produce el mismo resultado al repetirse. Transaccional: si algo falla, no se aplica nada.
begin;

-- 0. Precondiciones: el esquema v1 real debe existir tal como se espera.
do $$
declare
  missing text;
begin
  if to_regclass('public.album_photos') is null or to_regclass('public.album_members') is null then
    raise exception 'Faltan las tablas public.album_photos o public.album_members. No se aplica nada.';
  end if;
  select string_agg(required, ', ') into missing
  from unnest(array['id', 'storage_path', 'thumbnail_path', 'original_name', 'uploaded_by', 'created_at']) as required
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'album_photos' and c.column_name = required
  );
  if missing is not null then
    raise exception 'Faltan columnas v1 en album_photos: %. No se aplica nada.', missing;
  end if;
  if not exists (select 1 from storage.buckets where id = 'recuerdos') then
    raise exception 'No existe el bucket recuerdos. Esta migración no lo crea.';
  end if;
  if (select public from storage.buckets where id = 'recuerdos') then
    raise exception 'El bucket recuerdos es PÚBLICO. Hazlo privado antes de continuar; esta migración no lo cambia.';
  end if;
end $$;

-- 1. Columnas nuevas. ADD COLUMN con default constante no reescribe la tabla ni toca los datos actuales:
--    las filas existentes quedan como fotografías sin fecha del recuerdo, sin lugar y sin versión optimizada.
alter table public.album_photos
  add column if not exists media_type text not null default 'photo',
  add column if not exists memory_date date,
  add column if not exists place text,
  add column if not exists display_path text,
  add column if not exists duration_seconds numeric(5, 2);

comment on column public.album_photos.media_type is 'photo | video. Inmutable para los clientes.';
comment on column public.album_photos.memory_date is 'Fecha en que ocurrió el recuerdo (AAAA-MM-DD). NULL = la app usa la fecha de subida. Editable.';
comment on column public.album_photos.place is 'Nombre libre del lugar, 1-80 caracteres, sin GPS. Editable.';
comment on column public.album_photos.display_path is 'WebP optimizado (≤1600 px): display/<usuario>/<id>.webp. NULL en fotos antiguas y videos.';
comment on column public.album_photos.duration_seconds is 'Duración del video en segundos. NULL en fotos.';

-- 2. Restricciones de integridad (se crean solo si no existen con ese nombre).
--    Todas las filas existentes las cumplen: media_type = 'photo', duración y display_path NULL,
--    y el bucket nunca admitió MP4 hasta ahora.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'album_photos_media_type_check' and conrelid = 'public.album_photos'::regclass) then
    alter table public.album_photos add constraint album_photos_media_type_check
      check (media_type in ('photo', 'video'));
  end if;

  -- Un video es MP4 y dura (0, 15.05] s; nunca tiene versión de visualización.
  -- Una foto no es MP4 y no tiene duración. El margen de 0,05 s coincide con videoService.js
  -- (los contenedores MP4 suelen redondear la duración hacia arriba unas centésimas).
  if not exists (select 1 from pg_constraint where conname = 'album_photos_media_rules_check' and conrelid = 'public.album_photos'::regclass) then
    alter table public.album_photos add constraint album_photos_media_rules_check check (
      (media_type = 'photo' and duration_seconds is null and storage_path !~* '\.mp4$')
      or (media_type = 'video' and duration_seconds > 0 and duration_seconds <= 15.05
          and storage_path ~ '\.mp4$' and display_path is null)
    );
  end if;

  -- Mismas reglas que normalizePlace() en memories.js: sin controles C0/DEL, 1 a 80 caracteres.
  if not exists (select 1 from pg_constraint where conname = 'album_photos_place_check' and conrelid = 'public.album_photos'::regclass) then
    alter table public.album_photos add constraint album_photos_place_check
      check (place is null or (char_length(place) between 1 and 80 and place !~ '[\x01-\x1f\x7f]'));
  end if;

  -- parseMemoryDate() en memories.js exige además que no sea posterior a hoy.
  if not exists (select 1 from pg_constraint where conname = 'album_photos_memory_date_check' and conrelid = 'public.album_photos'::regclass) then
    alter table public.album_photos add constraint album_photos_memory_date_check
      check (memory_date is null or memory_date between date '1900-01-01' and date '2100-12-31');
  end if;

  -- Formato estricto de la versión optimizada. La pertenencia al usuario y al id se exige en RLS (PASO 2).
  if not exists (select 1 from pg_constraint where conname = 'album_photos_display_path_check' and conrelid = 'public.album_photos'::regclass) then
    alter table public.album_photos add constraint album_photos_display_path_check check (
      display_path is null
      or display_path ~ '^display/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    );
  end if;
end $$;

-- Ninguna versión optimizada puede pertenecer a dos recuerdos (la eliminación borraría la del otro).
create unique index if not exists album_photos_display_path_key
  on public.album_photos (display_path) where display_path is not null;

-- 3. Bucket privado: añade video/mp4 conservando los tipos actuales, sin duplicados.
--    Si allowed_mime_types fuera NULL (cualquier tipo), queda limitado a los cuatro formatos del álbum.
--    El límite de tamaño (10 MB) NO se modifica: cubre fotos (10 MB) y videos (5 MB).
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime order by mime)
  from unnest(coalesce(allowed_mime_types, array['image/jpeg', 'image/png', 'image/webp']) || array['video/mp4']) as mime
)
where id = 'recuerdos'
  and (allowed_mime_types is null or not ('video/mp4' = any(allowed_mime_types)));

-- PostgREST debe ver las columnas nuevas de inmediato.
notify pgrst, 'reload schema';

commit;
