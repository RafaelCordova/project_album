-- AUDITORÍA DE SOLO LECTURA. Ejecutar manualmente en SQL Editor como propietario.
-- No modifica datos, políticas, tablas ni archivos. No pegar resultados con datos personales en público.
begin read only;

-- 1. Columnas reales, tipos, nulabilidad y defaults. La app no depende de defaults.
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('album_members', 'album_photos')
order by table_name, ordinal_position;

-- 2. PK, FK, UNIQUE y CHECK existentes.
select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('album_members', 'album_photos');

-- 3. RLS debe estar habilitado en ambas tablas y en storage.objects.
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'public' and c.relname in ('album_members', 'album_photos'))
or (n.nspname = 'storage' and c.relname = 'objects');

-- 4. TODAS las políticas de objects: una política general puede alcanzar recuerdos.
-- Las PERMISSIVE se combinan con OR; las RESTRICTIVE añaden condiciones AND.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in ('album_members', 'album_photos'))
or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- 5. Privilegios efectivos, incluidos los heredados. No basta con revisar RLS.
select role_name, relation_name,
  has_table_privilege(role_name, relation_name, 'SELECT') as can_select,
  has_table_privilege(role_name, relation_name, 'INSERT') as can_insert,
  has_table_privilege(role_name, relation_name, 'UPDATE') as can_update,
  has_table_privilege(role_name, relation_name, 'DELETE') as can_delete,
  has_table_privilege(role_name, relation_name, 'TRUNCATE') as can_truncate,
  has_table_privilege(role_name, relation_name, 'TRIGGER') as can_create_trigger
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('public.album_members'), ('public.album_photos'), ('storage.objects')) t(relation_name);

select grantee, table_schema, table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name in ('album_members', 'album_photos')
order by table_name, grantee, column_name;

-- 6. Bucket: private, límite 10485760, MIME JPEG/PNG/WebP. No se cambia nada.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'recuerdos';

-- 7. Exactamente los dos UUID reales previstos. No insertar desde el navegador.
select user_id, count(*) as occurrences from public.album_members group by user_id;

-- 8. Revisar funciones SECURITY DEFINER/RPC, vistas y triggers que puedan eludir RLS.
select n.nspname, p.proname, p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
and (p.prosecdef or p.prosrc ilike '%album_%');

select schemaname, viewname, definition from pg_views
where schemaname = 'public' and definition ilike '%album_%';

select event_object_table, trigger_name, action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table in ('album_members', 'album_photos');

-- 9. Archivos sin metadatos. Una subida en curso puede aparecer aquí: no borrar automáticamente.
select o.name, o.created_at from storage.objects o
where o.bucket_id = 'recuerdos'
and not exists (select 1 from public.album_photos p where p.storage_path = o.name or p.thumbnail_path = o.name);

-- 10. Registros con originales o miniaturas ausentes; útil para eliminaciones pendientes.
select p.id, p.storage_path, p.thumbnail_path,
  not exists (select 1 from storage.objects o where o.bucket_id = 'recuerdos' and o.name = p.storage_path) as original_missing,
  p.thumbnail_path is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'recuerdos' and o.name = p.thumbnail_path) as thumbnail_missing
from public.album_photos p
where not exists (select 1 from storage.objects o where o.bucket_id = 'recuerdos' and o.name = p.storage_path)
or (p.thumbnail_path is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'recuerdos' and o.name = p.thumbnail_path));

rollback;
