-- PROPUESTA PARA REVISIÓN; NO APLICADA. No es una migración automática.
-- Primero ejecutar audit.sql y comparar con docs/SEGURIDAD.md.
-- Requiere autorización del propietario antes de ejecutarse.
-- No borra filas ni recrea tablas. Cambia privilegios y agrega políticas.
-- Si existen políticas RESTRICTIVE incompatibles (p. ej. solo el autor puede borrar),
-- deben revisarse por su nombre real y prepararse en otra migración autorizada.
-- No elimina políticas desconocidas. Si hay nombres repetidos, la transacción falla.
begin;

alter table public.album_members enable row level security;
alter table public.album_photos enable row level security;

-- El cliente jamás administra miembros ni modifica metadatos existentes.
revoke all privileges on table public.album_members from public, anon, authenticated;
revoke all privileges on table public.album_photos from public, anon, authenticated;
-- Los grants por columna son independientes de los grants de tabla.
revoke insert (user_id), update (user_id), references (user_id)
  on public.album_members from public, anon, authenticated;
revoke insert (id, storage_path, thumbnail_path, original_name, uploaded_by, created_at),
  update (id, storage_path, thumbnail_path, original_name, uploaded_by, created_at),
  references (id, storage_path, thumbnail_path, original_name, uploaded_by, created_at)
  on public.album_photos from public, anon, authenticated;
grant select on table public.album_members to authenticated;
grant select, insert, delete on table public.album_photos to authenticated;

-- SELECT de membresía propia evita autorreferencias recursivas en album_members.
create policy album_v1_members_guard on public.album_members as restrictive
for select to public using (user_id = (select auth.uid()));
create policy album_v1_members_read on public.album_members as permissive
for select to authenticated using (user_id = (select auth.uid()));
create policy album_v1_members_no_insert on public.album_members as restrictive
for insert to public with check (false);
create policy album_v1_members_no_update on public.album_members as restrictive
for update to public using (false) with check (false);
create policy album_v1_members_no_delete on public.album_members as restrictive
for delete to public using (false);

create policy album_v1_photos_guard on public.album_photos as restrictive
for all to public
using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())))
with check (
  uploaded_by = (select auth.uid())
  and exists (select 1 from public.album_members m where m.user_id = (select auth.uid()))
  and storage_path ~ ('^originals/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
  and (thumbnail_path is null or thumbnail_path ~ ('^thumbnails/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.webp$'))
);
create policy album_v1_photos_read on public.album_photos as permissive
for select to authenticated using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));
create policy album_v1_photos_insert on public.album_photos as permissive
for insert to authenticated with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));
create policy album_v1_photos_delete on public.album_photos as permissive
for delete to authenticated using (exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));
create policy album_v1_photos_no_update on public.album_photos as restrictive
for update to public using (false) with check (false);

-- No afecta otros buckets. El guard protege recuerdos incluso si otra política es USING(true).
-- No se usa owner = auth.uid() en SELECT/DELETE: ambos miembros comparten todas las fotos.
create policy album_v1_storage_guard on storage.objects as restrictive
for all to public
using (bucket_id <> 'recuerdos' or exists (select 1 from public.album_members m where m.user_id = (select auth.uid())))
with check (bucket_id <> 'recuerdos' or exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));
create policy album_v1_storage_insert_guard on storage.objects as restrictive
for insert to public with check (
  bucket_id <> 'recuerdos' or (
    name ~ ('^(originals|thumbnails)/' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
    and exists (select 1 from public.album_members m where m.user_id = (select auth.uid()))
  )
);
create policy album_v1_storage_no_update on storage.objects as restrictive
for update to public using (bucket_id <> 'recuerdos') with check (bucket_id <> 'recuerdos');
create policy album_v1_storage_read on storage.objects as permissive
for select to authenticated using (bucket_id = 'recuerdos' and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));
create policy album_v1_storage_insert on storage.objects as permissive
for insert to authenticated with check (bucket_id = 'recuerdos' and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));
create policy album_v1_storage_delete on storage.objects as permissive
for delete to authenticated using (bucket_id = 'recuerdos' and exists (select 1 from public.album_members m where m.user_id = (select auth.uid())));

-- El bucket debe seguir privado: esta propuesta NO cambia su configuración.
-- Revisar también RPC/vistas/grants heredados; este archivo no los puede adivinar.
commit;
