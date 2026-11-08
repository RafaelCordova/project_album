-- PASO 2 DE 2 — PERMISOS Y RLS v2 DE "NUESTRO ÁLBUM".
-- ESTADO: APLICADO en Supabase el 8 de noviembre de 2026 por el propietario, junto con el PASO 1.
-- supabase/verify-v2.sql dio 51/51 ok = true y se conservaron los 3 recuerdos existentes.
-- Ejecución MANUAL por el propietario en Supabase → SQL Editor, DESPUÉS del PASO 1
-- (supabase/migrations/20261106_recuerdos_v2.sql). Verificación: supabase/verify-v2.sql.
-- Informe y justificación de cada regla: docs/SQL_V2_AUDIT.md.
--
-- Estado de partida esperado (informado por el propietario el 7 de noviembre de 2026):
--   album_members : política "Members can view their own membership" (SELECT, authenticated).
--   album_photos  : "Album members can add/delete/update/view photo records" (PERMISSIVE, authenticated).
--   storage.objects: "Album members can delete/update/upload/view photos" (PERMISSIVE, authenticated).
--   Grants: authenticated SELECT en album_members; SELECT/INSERT/UPDATE/DELETE en album_photos.
--
-- Por qué se sustituyen las políticas permisivas existentes: las PERMISSIVE se combinan con OR,
-- así que añadir otras más estrictas no limitaría lo que ya permiten. Este script:
--   1. Se DETIENE si encuentra cualquier política desconocida que pueda afectar al álbum
--      (no elimina nada que no conozca por su nombre exacto).
--   2. Elimina solo las 8 políticas conocidas de album_photos y storage.objects, y las sustituye por
--      equivalentes v2 explícitas. Conserva "Members can view their own membership".
--   3. Añade políticas RESTRICTIVE (se combinan con AND) que siguen protegiendo aunque en el futuro
--      alguien añada por error una política permisiva demasiado amplia.
--   4. Aplica privilegios mínimos por tabla y por columna.
--
-- No usa funciones SECURITY DEFINER: la membresía se comprueba con una subconsulta sobre
-- album_members, que RLS ya limita a la fila propia (exactamente lo que se necesita comprobar).
-- No concede nada a anon ni a PUBLIC. No cambia el bucket ni los usuarios.
-- Idempotente: puede ejecutarse de nuevo; recrea las políticas v2 con la misma definición.
begin;

-- 0. Precondiciones.
do $$
declare
  unknown text;
begin
  -- El PASO 1 debe estar aplicado: las reglas usan las columnas v2.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'album_photos'
      and column_name in ('media_type', 'memory_date', 'place', 'display_path', 'duration_seconds')) <> 5 then
    raise exception 'Ejecuta primero supabase/migrations/20261106_recuerdos_v2.sql (faltan columnas v2). No se aplica nada.';
  end if;
  if (select public from storage.buckets where id = 'recuerdos') is distinct from false then
    raise exception 'El bucket recuerdos no existe o es público. No se aplica nada.';
  end if;

  -- Políticas desconocidas en las tablas del álbum: se detiene para revisión manual.
  select string_agg(format('%I.%I: %s', schemaname, tablename, policyname), '; ') into unknown
  from pg_policies
  where schemaname = 'public' and tablename in ('album_members', 'album_photos')
    and policyname not like 'album\_v2\_%'
    and policyname not in (
      'Members can view their own membership',
      'Album members can add photo records', 'Album members can delete photo records',
      'Album members can update photo records', 'Album members can view photo records');
  if unknown is not null then
    raise exception 'Hay políticas desconocidas que no se eliminarán automáticamente: %. Revísalas y vuelve a ejecutar.', unknown;
  end if;

  -- En storage.objects solo se aceptan sin revisión las políticas acotadas a OTRO bucket.
  -- Cualquier política desconocida que mencione "recuerdos" o no filtre por bucket_id podría afectar al álbum.
  select string_agg(format('storage.objects: %s', policyname), '; ') into unknown
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname not like 'album\_v2\_%'
    and policyname not in ('Album members can delete photos', 'Album members can update photos',
                           'Album members can upload photos', 'Album members can view photos')
    and ((coalesce(qual, '') || coalesce(with_check, '')) ~ 'recuerdos'
         or (coalesce(qual, '') || coalesce(with_check, '')) !~ 'bucket_id');
  if unknown is not null then
    raise exception 'Hay políticas de Storage desconocidas que pueden afectar al bucket recuerdos: %. Revísalas y vuelve a ejecutar.', unknown;
  end if;
end $$;

-- 1. RLS habilitado (no se desactiva nunca). storage.objects ya lo tiene en Supabase.
alter table public.album_members enable row level security;
alter table public.album_photos enable row level security;

-- 2. Privilegios mínimos.
--    Se revocan también los privilegios por columna, porque un REVOKE de tabla no los elimina.
revoke all privileges on table public.album_members from public, anon, authenticated;
revoke all privileges on table public.album_photos from public, anon, authenticated;
do $$
declare
  col record;
begin
  -- Recorre las columnas que existen realmente (p. ej. album_members.added_at) y quita cualquier
  -- privilegio por columna que se hubiera concedido de forma explícita.
  for col in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name in ('album_members', 'album_photos')
  loop
    execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.%2$I from public, anon, authenticated', col.column_name, col.table_name);
  end loop;
end $$;
grant select on table public.album_members to authenticated;
-- Lectura y eliminación de filas completas.
grant select, delete on table public.album_photos to authenticated;
-- INSERT solo de las 11 columnas que envía photoService.upload (una columna futura no quedará incluida).
grant insert (id, storage_path, thumbnail_path, original_name, uploaded_by, created_at, media_type, memory_date, place, display_path, duration_seconds)
  on public.album_photos to authenticated;
-- UPDATE solo de la fecha del recuerdo y el lugar.
grant update (memory_date, place) on public.album_photos to authenticated;

-- 3. album_members: se conserva "Members can view their own membership" y se añade un límite RESTRICTIVE.
--    Sin privilegios INSERT/UPDATE/DELETE, los clientes no pueden crear, cambiar ni borrar membresías.
drop policy if exists album_v2_members_guard on public.album_members;
create policy album_v2_members_guard on public.album_members as restrictive
for all to public
using (user_id = (select auth.uid()))
with check (false);
-- Si la política original no existiera, se crea una equivalente.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'album_members' and policyname = 'Members can view their own membership') then
    drop policy if exists album_v2_members_read on public.album_members;
    create policy album_v2_members_read on public.album_members as permissive
    for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

-- 4. album_photos: sustitución de las 4 políticas conocidas por las v2.
drop policy if exists "Album members can add photo records" on public.album_photos;
drop policy if exists "Album members can delete photo records" on public.album_photos;
drop policy if exists "Album members can update photo records" on public.album_photos;
drop policy if exists "Album members can view photo records" on public.album_photos;
drop policy if exists album_v2_photos_member_guard on public.album_photos;
drop policy if exists album_v2_photos_insert_guard on public.album_photos;
drop policy if exists album_v2_photos_select on public.album_photos;
drop policy if exists album_v2_photos_insert on public.album_photos;
drop policy if exists album_v2_photos_update_details on public.album_photos;
drop policy if exists album_v2_photos_delete on public.album_photos;

-- RESTRICTIVE: toda operación exige membresía.
create policy album_v2_photos_member_guard on public.album_photos as restrictive
for all to public
using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())))
with check (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

-- RESTRICTIVE: una fila nueva pertenece a quien la sube y sus rutas son exactamente las que genera
-- photoService.upload: <carpeta>/<auth.uid()>/<id de la fila>.<extensión>. Evita registrar archivos
-- ajenos o de otra fila (eliminarla borraría archivos de otro recuerdo).
create policy album_v2_photos_insert_guard on public.album_photos as restrictive
for insert to public
with check (
  uploaded_by = (select auth.uid())
  and storage_path ~ ('^originals/' || (select auth.uid())::text || '/' || id::text || '\.(jpg|png|webp|mp4)$')
  and (thumbnail_path is null or thumbnail_path = 'thumbnails/' || (select auth.uid())::text || '/' || id::text || '.webp')
  and (display_path is null or display_path = 'display/' || (select auth.uid())::text || '/' || id::text || '.webp')
);

create policy album_v2_photos_select on public.album_photos as permissive
for select to authenticated
using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

create policy album_v2_photos_insert on public.album_photos as permissive
for insert to authenticated
with check (uploaded_by = (select auth.uid())
  and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

-- Cualquier miembro edita fecha y lugar de cualquier recuerdo; las columnas las limita el GRANT del paso 2.
create policy album_v2_photos_update_details on public.album_photos as permissive
for update to authenticated
using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())))
with check (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

create policy album_v2_photos_delete on public.album_photos as permissive
for delete to authenticated
using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

-- 5. storage.objects (solo el bucket recuerdos): sustitución de las 4 políticas conocidas.
--    No hay política de UPDATE: nadie puede sobrescribir ni mover objetos (compatible con upsert: false).
drop policy if exists "Album members can delete photos" on storage.objects;
drop policy if exists "Album members can update photos" on storage.objects;
drop policy if exists "Album members can upload photos" on storage.objects;
drop policy if exists "Album members can view photos" on storage.objects;
drop policy if exists album_v2_storage_member_guard on storage.objects;
drop policy if exists album_v2_storage_insert_guard on storage.objects;
drop policy if exists album_v2_storage_no_update on storage.objects;
drop policy if exists album_v2_storage_select on storage.objects;
drop policy if exists album_v2_storage_insert on storage.objects;
drop policy if exists album_v2_storage_delete on storage.objects;

-- RESTRICTIVE: en recuerdos, toda operación exige membresía. Otros buckets no se ven afectados.
create policy album_v2_storage_member_guard on storage.objects as restrictive
for all to public
using (bucket_id <> 'recuerdos' or exists (select 1 from public.album_members m where m.user_id = (select auth.uid())))
with check (bucket_id <> 'recuerdos' or exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

-- RESTRICTIVE: solo rutas propias y extensiones del álbum. La expresión está anclada (^...$),
-- exige UUID en minúsculas en carpeta y archivo, y no admite '..', '/' inicial ni subcarpetas extra.
--   originals/<auth.uid()>/<uuid>.(jpg|png|webp|mp4)
--   thumbnails/<auth.uid()>/<uuid>.webp      display/<auth.uid()>/<uuid>.webp
create policy album_v2_storage_insert_guard on storage.objects as restrictive
for insert to public
with check (
  bucket_id <> 'recuerdos'
  or name ~ ('^originals/' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$')
  or name ~ ('^(thumbnails|display)/' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
);

-- RESTRICTIVE: ningún UPDATE en recuerdos, aunque en el futuro se añada una política permisiva.
create policy album_v2_storage_no_update on storage.objects as restrictive
for update to public
using (bucket_id <> 'recuerdos')
with check (bucket_id <> 'recuerdos');

-- PERMISSIVE: ambos miembros leen (firman URLs) y eliminan todo el álbum, incluidas rutas antiguas.
create policy album_v2_storage_select on storage.objects as permissive
for select to authenticated
using (bucket_id = 'recuerdos' and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

create policy album_v2_storage_insert on storage.objects as permissive
for insert to authenticated
with check (bucket_id = 'recuerdos' and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

create policy album_v2_storage_delete on storage.objects as permissive
for delete to authenticated
using (bucket_id = 'recuerdos' and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

notify pgrst, 'reload schema';

commit;
