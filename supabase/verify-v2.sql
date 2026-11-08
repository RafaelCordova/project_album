-- VERIFICACIÓN v2 DE SOLO LECTURA. Ejecutar en Supabase → SQL Editor DESPUÉS de los pasos 1 y 2.
-- No modifica nada: es una única sentencia SELECT (el SQL Editor solo muestra la última sentencia).
-- Resultado esperado: TODAS las filas con ok = true. Una fila con ok = false indica qué revisar.
-- No muestra datos personales: solo nombres de objetos, conteos y configuración.
with
expected_cols(column_name, data_type, nullable, default_like) as (values
  ('media_type', 'text', 'NO', '''photo''%'),
  ('memory_date', 'date', 'YES', null),
  ('place', 'text', 'YES', null),
  ('display_path', 'text', 'YES', null),
  ('duration_seconds', 'numeric', 'YES', null)
),
insertable(column_name) as (values
  ('id'), ('storage_path'), ('thumbnail_path'), ('original_name'), ('uploaded_by'), ('created_at'),
  ('media_type'), ('memory_date'), ('place'), ('display_path'), ('duration_seconds')
),
photo_cols as (
  select column_name from information_schema.columns where table_schema = 'public' and table_name = 'album_photos'
),
photo_policies as (
  select policyname, permissive, cmd from pg_policies where schemaname = 'public' and tablename = 'album_photos'
),
storage_policies as (
  select policyname, permissive, cmd, coalesce(qual, '') || coalesce(with_check, '') as body
  from pg_policies where schemaname = 'storage' and tablename = 'objects'
),
checks(orden, comprobacion, ok, detalle) as (
  -- Columnas
  select 1, 'Columna ' || e.column_name || ' (' || e.data_type || ')',
    c.column_name is not null and c.data_type = e.data_type and c.is_nullable = e.nullable
      and (e.default_like is null or c.column_default like e.default_like)
      and (e.column_name <> 'duration_seconds' or (c.numeric_precision = 5 and c.numeric_scale = 2)),
    coalesce(c.data_type || ', nullable=' || c.is_nullable || ', default=' || coalesce(c.column_default, '-'), 'NO EXISTE')
  from expected_cols e
  left join information_schema.columns c on c.table_schema = 'public' and c.table_name = 'album_photos' and c.column_name = e.column_name

  -- Constraints e índice
  union all
  select 2, 'Constraint ' || n.name,
    exists (select 1 from pg_constraint where conname = n.name and conrelid = 'public.album_photos'::regclass and convalidated),
    coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = n.name and conrelid = 'public.album_photos'::regclass), 'NO EXISTE')
  from (values ('album_photos_media_type_check'), ('album_photos_media_rules_check'), ('album_photos_place_check'),
               ('album_photos_memory_date_check'), ('album_photos_display_path_check')) n(name)
  union all
  select 3, 'Índice único parcial album_photos_display_path_key',
    exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'album_photos_display_path_key'
            and indexdef ilike '%unique%' and indexdef ilike '%display_path IS NOT NULL%'),
    coalesce((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'album_photos_display_path_key'), 'NO EXISTE')

  -- RLS
  union all
  select 4, 'RLS habilitado en ' || n.nspname || '.' || c.relname, c.relrowsecurity, 'relrowsecurity=' || c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where (n.nspname = 'public' and c.relname in ('album_members', 'album_photos')) or (n.nspname = 'storage' and c.relname = 'objects')

  -- Políticas de album_members
  union all
  select 5, 'album_members: solo lectura de la fila propia',
    (select count(*) from pg_policies where schemaname = 'public' and tablename = 'album_members' and permissive = 'PERMISSIVE') = 1
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'album_members' and permissive = 'PERMISSIVE'
                and cmd = 'SELECT' and qual ~ 'user_id = .*auth\.uid\(\)')
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'album_members' and policyname = 'album_v2_members_guard' and permissive = 'RESTRICTIVE'),
    (select string_agg(policyname || ' [' || permissive || ' ' || cmd || ']', '; ') from pg_policies where schemaname = 'public' and tablename = 'album_members')

  -- Políticas de album_photos: exactamente las seis v2
  union all
  select 6, 'album_photos: exactamente las 6 políticas v2',
    (select count(*) from photo_policies) = 6
    and (select count(*) from photo_policies where policyname in ('album_v2_photos_member_guard', 'album_v2_photos_insert_guard', 'album_v2_photos_select',
         'album_v2_photos_insert', 'album_v2_photos_update_details', 'album_v2_photos_delete')) = 6,
    (select string_agg(policyname || ' [' || permissive || ' ' || cmd || ']', '; ' order by policyname) from photo_policies)

  -- Políticas de Storage
  union all
  select 7, 'storage.objects: 6 políticas v2 presentes',
    (select count(*) from storage_policies where policyname in ('album_v2_storage_member_guard', 'album_v2_storage_insert_guard', 'album_v2_storage_no_update',
         'album_v2_storage_select', 'album_v2_storage_insert', 'album_v2_storage_delete')) = 6,
    (select string_agg(policyname, '; ' order by policyname) from storage_policies where policyname like 'album\_v2\_%')
  union all
  select 8, 'Políticas antiguas "Album members can ..." eliminadas',
    not exists (select 1 from pg_policies where policyname like 'Album members can %'),
    coalesce((select string_agg(policyname, '; ') from pg_policies where policyname like 'Album members can %'), 'ninguna')
  union all
  select 9, 'storage.objects: ninguna política PERMISSIVE de UPDATE que alcance recuerdos',
    not exists (select 1 from storage_policies where permissive = 'PERMISSIVE' and cmd in ('UPDATE', 'ALL') and (body ~ 'recuerdos' or body !~ 'bucket_id')),
    coalesce((select string_agg(policyname, '; ') from storage_policies where permissive = 'PERMISSIVE' and cmd in ('UPDATE', 'ALL') and (body ~ 'recuerdos' or body !~ 'bucket_id')), 'ninguna')
  union all
  select 10, 'Ninguna política del álbum con USING/CHECK (true)',
    not exists (select 1 from pg_policies where ((schemaname = 'public' and tablename in ('album_members', 'album_photos')) or (schemaname = 'storage' and tablename = 'objects'))
                and permissive = 'PERMISSIVE' and (qual = 'true' or with_check = 'true')),
    'revisión de expresiones triviales'

  -- Privilegios de tabla
  union all
  select 11, 'anon y PUBLIC sin privilegios en las tablas del álbum',
    not exists (
      select 1 from (values ('public.album_members'), ('public.album_photos')) t(rel)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
      where has_table_privilege('anon', t.rel, p.priv)
         or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege('anon', t.rel, p.priv))
         or exists (select 1 from information_schema.role_table_grants g where g.grantee = 'PUBLIC' and g.table_schema = 'public' and g.table_name = split_part(t.rel, '.', 2))),
    'has_table_privilege(anon, ...) y grants a PUBLIC'
  union all
  select 12, 'authenticated en album_members: solo SELECT',
    has_table_privilege('authenticated', 'public.album_members', 'SELECT')
    and not has_table_privilege('authenticated', 'public.album_members', 'INSERT')
    and not has_table_privilege('authenticated', 'public.album_members', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.album_members', 'DELETE')
    and not has_table_privilege('authenticated', 'public.album_members', 'TRUNCATE')
    and not has_any_column_privilege('authenticated', 'public.album_members', 'INSERT')
    and not has_any_column_privilege('authenticated', 'public.album_members', 'UPDATE'),
    'tabla y columnas'
  union all
  select 13, 'authenticated en album_photos: SELECT y DELETE de tabla; sin INSERT/UPDATE de tabla, TRUNCATE ni TRIGGER',
    has_table_privilege('authenticated', 'public.album_photos', 'SELECT')
    and has_table_privilege('authenticated', 'public.album_photos', 'DELETE')
    and not has_table_privilege('authenticated', 'public.album_photos', 'INSERT')
    and not has_table_privilege('authenticated', 'public.album_photos', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.album_photos', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.album_photos', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.album_photos', 'REFERENCES'),
    'has_table_privilege'

  -- Privilegios por columna efectivos
  union all
  select 14, 'UPDATE de ' || c.column_name || (case when c.column_name in ('memory_date', 'place') then ' permitido' else ' denegado' end),
    has_column_privilege('authenticated', 'public.album_photos', c.column_name, 'UPDATE') = (c.column_name in ('memory_date', 'place'))
    and not has_column_privilege('anon', 'public.album_photos', c.column_name, 'UPDATE'),
    'authenticated=' || has_column_privilege('authenticated', 'public.album_photos', c.column_name, 'UPDATE')
  from photo_cols c
  union all
  select 15, 'INSERT de ' || c.column_name || (case when i.column_name is not null then ' permitido' else ' denegado' end),
    has_column_privilege('authenticated', 'public.album_photos', c.column_name, 'INSERT') = (i.column_name is not null)
    and not has_column_privilege('anon', 'public.album_photos', c.column_name, 'INSERT'),
    'authenticated=' || has_column_privilege('authenticated', 'public.album_photos', c.column_name, 'INSERT')
  from photo_cols c left join insertable i using (column_name)

  -- Bucket
  union all
  select 16, 'Bucket recuerdos privado',
    coalesce((select not public from storage.buckets where id = 'recuerdos'), false),
    coalesce((select 'public=' || public from storage.buckets where id = 'recuerdos'), 'NO EXISTE')
  union all
  select 17, 'Bucket recuerdos: MIME exactamente jpeg, png, webp y mp4',
    coalesce((select allowed_mime_types::text[] @> array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
                     and allowed_mime_types::text[] <@ array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
              from storage.buckets where id = 'recuerdos'), false),
    coalesce((select array_to_string(allowed_mime_types, ', ') from storage.buckets where id = 'recuerdos'), 'NULL (cualquier tipo)')
  union all
  select 18, 'Bucket recuerdos: límite de tamaño definido y ≤ 10 MB',
    coalesce((select file_size_limit is not null and file_size_limit <= 10485760 from storage.buckets where id = 'recuerdos'), false),
    coalesce((select file_size_limit::text from storage.buckets where id = 'recuerdos'), 'NULL')

  -- Membresías y datos existentes
  union all
  select 19, 'album_members: exactamente los dos UUID del álbum',
    (select count(*) from public.album_members) = 2
    and (select count(*) from public.album_members where user_id in ('712d76e1-9ebd-4f81-8298-8895bee0836a', '01bdb554-3b7f-4400-802b-e5ddd9b19457')) = 2,
    (select count(*) || ' filas' from public.album_members)
  union all
  -- Informativo: compara este número con el de audit.sql antes de migrar (no debe disminuir).
  select 20, 'Recuerdos existentes conservados (compara con el conteo previo)', true,
    (select count(*) || ' filas en album_photos' from public.album_photos)
  union all
  select 21, 'Sin funciones SECURITY DEFINER en public ejecutables por anon/authenticated',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosecdef
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
    coalesce((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prosecdef), 'ninguna')
)
select orden, comprobacion, ok, detalle from checks order by orden, comprobacion;
