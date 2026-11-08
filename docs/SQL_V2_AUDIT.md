# Auditoría y corrección de los SQL v2

Fecha: 7 de noviembre de 2026. Base: el estado real de Supabase informado por el propietario (políticas `Album members can …`, grants de `authenticated`, bucket privado de 10 MB con JPEG/PNG/WebP).

**Estado (8 de noviembre de 2026):** el propietario aplicó en Supabase el PASO 1 y el PASO 2 (con los ajustes D1-D4 de la revisión final). `supabase/verify-v2.sql` dio 51/51 `ok = true` y se conservaron los 3 recuerdos existentes.

Durante esta auditoría no se ejecutó nada en el proyecto Supabase real: la aplicación la hizo el propietario manualmente. Las pruebas de esta auditoría se hicieron en PostgreSQL 18 local (PGlite 0.5.15) sobre una réplica de ese estado. Esa réplica incluye las columnas exactas (con `added_at`), la FK a `auth.users`, las 9 políticas con sus nombres reales, los grants informados, roles `anon`/`authenticated` y una simulación de `auth.uid()` y de `storage.objects`/`storage.buckets`. La réplica no reproduce el servidor de Storage ni PostgREST. Las expresiones exactas de las políticas reales no se conocían: se supusieron comprobaciones de membresía.

## 1. Problemas encontrados

| # | Gravedad | Archivo | Problema |
| --- | --- | --- | --- |
| 1 | **Alta** | migración v2 | Solo sustituía políticas `album_v1_*`, que **no existen** en el proyecto real. Las 8 políticas permisivas reales seguían activas y, al combinarse con OR, ninguna regla nueva de rutas o autoría se aplicaba en la práctica. |
| 2 | **Alta** | migración v2 | La política real `Album members can update photos` (UPDATE en Storage) seguía activa: un miembro podía sobrescribir o mover objetos (`upsert: true`, `move`). |
| 3 | **Alta** | migración v2 | `Album members can upload photos` no limita rutas (se desconoce su expresión): un miembro podía escribir en la carpeta del otro o con cualquier extensión permitida por MIME. |
| 4 | Media | migración v2 | `REVOKE UPDATE ON TABLE` no elimina privilegios por columna concedidos de forma explícita. Si `UPDATE (storage_path, …)` existía por columna, seguiría vigente. |
| 5 | Media | migración v2 | Se mantenía `INSERT` de tabla completa: cualquier columna futura quedaría insertable desde el cliente. |
| 6 | Media | migración v2 | Las rutas usaban `[0-9a-f-]{36}` (acepta `----…`) y no vinculaban el UUID del archivo con el `id` de la fila: se podía registrar una fila que apuntara a archivos de otro recuerdo; al eliminarla se borrarían esos archivos. |
| 7 | Media | migración v2 ↔ `videoService.js` | El CHECK exigía duración ≤ 15, pero el cliente acepta hasta 15,05 s (los MP4 suelen redondear hacia arriba). Un video de 15,02 s se subía, el INSERT fallaba, se borraban los archivos y se mostraba un error genérico. |
| 8 | Baja | migración v2 ↔ `memories.js` | El CHECK de lugar usaba `[[:cntrl:]]`, que en UTF-8 puede incluir controles C1 que el cliente no elimina: un INSERT/UPDATE válido para la app podía fallar. |
| 9 | Media | `proposed-policies.sql` | Obsoleto respecto al estado real: no eliminaba las políticas `Album members can …` (los nombres se repetían por OR), bloqueaba todo UPDATE (incompatible con la edición de fecha y lugar), solo admitía jpg/png/webp y no conocía `display/`. Aplicarlo **después** de la migración rompía v2. |
| 10 | Baja | `audit.sql` | La sección 11 consultaba columnas v2 y fallaba antes de migrar; la búsqueda de huérfanos no contemplaba `display/`. |
| 11 | Baja | migración v2 | Sin `notify pgrst`: PostgREST podía tardar en ver las columnas nuevas (Supabase suele recargar solo; se añade por seguridad). |
| 12 | Baja | documentación | `MEJORAS.md`, `SEGURIDAD.md`, `README.md` y `VERIFICACION.md` describían el reemplazo de políticas `album_v1_*` y un orden de ejecución que ya no aplica. |

No se encontraron errores de sintaxis del tipo `wherem.user_id`: todos los SQL se ejecutaron completos en PostgreSQL.

## 2. Cambios realizados

El trabajo se separa en dos pasos con responsabilidades claras.

**PASO 1 — `supabase/migrations/20261106_recuerdos_v2.sql` (esquema y bucket, solo aditivo)**

- Precondiciones: existen ambas tablas y las 6 columnas v1; el bucket existe y es privado. Si no, se detiene sin aplicar nada.
- 5 columnas con valores neutros (`media_type` = `'photo'`).
- 5 CHECK alineados con el JavaScript:
  - duración (0, 15,05];
  - lugar sin controles C0/DEL;
  - `display_path` con UUID estrictos.
- Índice único parcial sobre `display_path`.
- `video/mp4` en el bucket, sin tocar el límite de tamaño ni la privacidad.
- `notify pgrst`.
- **Ya no toca permisos ni políticas.**

**PASO 2 — `supabase/proposed-policies.sql` (permisos y RLS, reescrito)**

- Precondiciones:
  - el PASO 1 está aplicado;
  - el bucket es privado;
  - **no hay políticas desconocidas** en `album_members` o `album_photos`, ni políticas de Storage que mencionen `recuerdos` o no filtren por bucket. Si las hay, se detiene y las enumera; **no elimina nada que no conozca por nombre exacto**. Las políticas de otros buckets se respetan.
- Elimina **por nombre exacto** las 8 políticas `Album members can …` y crea las v2.
- Conserva `Members can view their own membership` (si faltara, crea una equivalente).
- Revoca privilegios de tabla y **de cada columna existente** para `public`, `anon` y `authenticated`, y concede solo lo necesario (sección 3).
- Añade políticas RESTRICTIVE (se combinan con AND) para que una política permisiva amplia añadida en el futuro no abra el álbum. Se probó añadiendo `USING (true) WITH CHECK (true)`.
- Sin funciones SECURITY DEFINER: la membresía se comprueba con `exists (select 1 from album_members where user_id = auth.uid())`, que RLS limita a la fila propia.

**Nuevos**: `supabase/verify-v2.sql` (verificación de solo lectura con `ok = true/false`) y este informe.

**Ajustados**: `supabase/audit.sql` (seguro antes y después de migrar) y la documentación.

**JavaScript**: sin cambios. Las discrepancias se resolvieron en SQL (problemas 7 y 8).

## 3. Permisos finales

| Rol | Objeto | Permisos |
| --- | --- | --- |
| `anon`, `PUBLIC` | `album_members`, `album_photos` | Ninguno |
| `authenticated` | `album_members` | `SELECT` (RLS: solo su fila) |
| `authenticated` | `album_photos` | `SELECT`, `DELETE` de tabla |
| `authenticated` | `album_photos` | `INSERT` solo de: `id, storage_path, thumbnail_path, original_name, uploaded_by, created_at, media_type, memory_date, place, display_path, duration_seconds` |
| `authenticated` | `album_photos` | `UPDATE` solo de: `memory_date, place` |
| `authenticated` | ambas tablas | Sin `TRUNCATE`, `TRIGGER` ni `REFERENCES` |

Storage no cambia de grants (los gestiona Supabase); su acceso se controla con RLS.

## 4. Políticas finales

**`public.album_members`**

| Política | Tipo | Comando | Regla |
| --- | --- | --- | --- |
| `Members can view their own membership` (existente) | PERMISSIVE | SELECT | `user_id = auth.uid()` |
| `album_v2_members_guard` | RESTRICTIVE | ALL | USING `user_id = auth.uid()`, CHECK `false` |

**`public.album_photos`** (*miembro* = existe su fila en `album_members`)

| Política | Tipo | Comando | Regla |
| --- | --- | --- | --- |
| `album_v2_photos_member_guard` | RESTRICTIVE | ALL | miembro |
| `album_v2_photos_insert_guard` | RESTRICTIVE | INSERT | `uploaded_by = auth.uid()` y rutas exactas `originals/<uid>/<id>.(jpg\|png\|webp\|mp4)`, `thumbnails/<uid>/<id>.webp`, `display/<uid>/<id>.webp` |
| `album_v2_photos_select` | PERMISSIVE | SELECT | miembro |
| `album_v2_photos_insert` | PERMISSIVE | INSERT | miembro y `uploaded_by = auth.uid()` |
| `album_v2_photos_update_details` | PERMISSIVE | UPDATE | miembro (columnas limitadas por GRANT) |
| `album_v2_photos_delete` | PERMISSIVE | DELETE | miembro |

**`storage.objects`** (solo afecta a `bucket_id = 'recuerdos'`)

| Política | Tipo | Comando | Regla |
| --- | --- | --- | --- |
| `album_v2_storage_member_guard` | RESTRICTIVE | ALL | otro bucket o miembro |
| `album_v2_storage_insert_guard` | RESTRICTIVE | INSERT | otro bucket o nombre `^originals/<uid>/<uuid>\.(jpg\|png\|webp\|mp4)$` o `^(thumbnails\|display)/<uid>/<uuid>\.webp$` |
| `album_v2_storage_no_update` | RESTRICTIVE | UPDATE | solo otros buckets: nadie actualiza ni sobrescribe en `recuerdos` |
| `album_v2_storage_select` | PERMISSIVE | SELECT | `recuerdos` y miembro (incluye rutas antiguas) |
| `album_v2_storage_insert` | PERMISSIVE | INSERT | `recuerdos` y miembro |
| `album_v2_storage_delete` | PERMISSIVE | DELETE | `recuerdos` y miembro |

Las expresiones regulares están ancladas (`^…$`), exigen UUID en minúsculas (como `crypto.randomUUID()` y `auth.uid()`) y no admiten `..`, `/` inicial, subcarpetas extra, mayúsculas en la extensión ni dobles extensiones.

## 5. Compatibilidad con los registros existentes

- Las filas actuales reciben `media_type = 'photo'` y `NULL` en el resto. Cumplen todos los CHECK: el bucket nunca admitió MP4.
- No se reescriben ni modifican rutas. SELECT y DELETE en Storage no exigen formato de ruta: las fotos con rutas heredadas (p. ej. `fotos antiguas/verano bonito.png`) se siguen viendo y se pueden borrar. Probado.
- Las reglas de rutas solo se aplican a **inserciones nuevas**, con el formato que ya generaba la app v1. La inserción de respaldo de 6 columnas (modo v1) sigue funcionando.
- Tras el PASO 1 (antes del PASO 2), la app ya funciona en modo v2 con las políticas antiguas, que además dejan editables las columnas nuevas (`media_type`, `display_path`, `duration_seconds`). Ejecuta el PASO 2 justo después.

## 6. Requisitos para activar videos

1. PASO 1 aplicado: columnas v2 y `video/mp4` en el bucket.
2. PASO 2 aplicado: admite `originals/<uid>/<uuid>.mp4` y la portada `thumbnails/<uid>/<uuid>.webp`.
3. Recargar la app: `photoService.detectSchema()` detecta v2 y muestra «Solo videos» y el lápiz de edición.

El límite del bucket (10 MB) no se aumenta. Los 5 MB, H.264/AAC, MP4 y 15 s se validan en el navegador; la base de datos rechaza duraciones mayores de 15,05 s y MP4 registrados como foto. Supabase no permite un límite de tamaño por tipo dentro de un bucket.

## 7. Orden exacto de ejecución (manual, en Supabase → SQL Editor)

1. `supabase/audit.sql` — solo lectura. Anota cuántas filas tiene `album_photos` y guarda el resultado en privado.
2. `supabase/verify-v2.sql` — opcional (con D1 aplicado). Debe mostrar varias filas `ok = false` (es lo esperado antes de migrar) y ningún error.
3. `supabase/migrations/20261106_recuerdos_v2.sql` — PASO 1.
4. `supabase/proposed-policies.sql` — PASO 2, en la misma sesión, justo después.
5. `supabase/verify-v2.sql` — **todas** las filas deben ser `ok = true`. La fila 20 debe mostrar el mismo número de recuerdos que la consulta 7b de `audit.sql` en el paso 1.
6. En la app, con ambas cuentas: las pruebas manuales de `docs/MEJORAS.md` §6 y `npm run check:remote`.

Si el PASO 2 se detiene por políticas desconocidas, no las borres a ciegas: revisa su definición (sección 4 de `audit.sql`) y decide.

Si el SQL Editor rechazara operar sobre `storage.objects` o `storage.buckets` por permisos de propietario, haz lo equivalente desde **Storage → Policies** y **Storage → Buckets**, y vuelve a ejecutar `verify-v2.sql`.

## 8. Cómo comprobar que quedó aplicado

`supabase/verify-v2.sql` devuelve 51 comprobaciones con `ok` en una única sentencia SELECT. Cubre:

- las 5 columnas (tipo, nulabilidad, default, precisión);
- los 5 CHECK validados;
- el índice único parcial;
- RLS habilitado en las tres tablas;
- el conjunto exacto de políticas;
- la ausencia de las políticas antiguas, de UPDATE permisivo en Storage y de `USING (true)`;
- los privilegios efectivos de tabla y de **cada columna** (`has_column_privilege`), para `anon` y `authenticated`;
- el bucket privado, con MIME exactos y límite ≤ 10 MB;
- las dos membresías exactas.

También lista funciones SECURITY DEFINER de `public` ejecutables por clientes.

Resultados en local sobre la réplica:

- 76 comprobaciones de comportamiento correctas, entre ellas:
  - membresías: solo la propia; no se crean, cambian ni borran;
  - lectura compartida, incluidas rutas heredadas;
  - inserción con el JSON exacto de `photoService.upload`;
  - video de 15,03 s aceptado y de 15,2 s rechazado;
  - rechazo de MOV, de MP4 como foto, de `uploaded_by` ajeno, de rutas en la carpeta del otro, de UUID distinto al `id`, de reutilizar el `display/` de otro, de traversal y de rutas absolutas;
  - edición de fecha y lugar por ambos y denegación de las otras 9 columnas;
  - borrado compartido;
  - 13 rutas de Storage inválidas rechazadas;
  - Storage sin UPDATE;
  - otros buckets no afectados;
  - resistencia a una política permisiva amplia añadida.
- Idempotencia: cada paso se ejecutó dos veces sin errores.
- Precondiciones:
  - el PASO 2 antes del 1 se detiene;
  - una política desconocida detiene el PASO 2 sin borrar nada;
  - con el bucket público, el PASO 1 no aplica nada.
- `verify-v2.sql` no falla en ninguna etapa; `audit.sql` funciona antes y después.

## 9. Riesgos y limitaciones restantes

- **Pruebas locales frente a Supabase real.** PGlite es PostgreSQL real, pero no incluye el servidor de Storage, PostgREST ni los propietarios reales de `storage.objects` (`supabase_storage_admin`). El resultado real se confirmó tras aplicar los dos pasos el 8 de noviembre de 2026: `verify-v2.sql` 51/51 `ok = true` y 3 recuerdos conservados.
- El tamaño de 5 MB y los códecs de video solo se garantizan en el cliente. El bucket aplica 10 MB a todo y comprueba el MIME **declarado**, no el contenido. Con dos miembros de confianza, el riesgo es bajo.
- `created_at` lo envía el cliente, como antes de v2. Un default de servidor exigiría otra migración y un cambio en `photoService.js`; no se hizo para no alterar la app.
- Los archivos que se suben y nunca llegan a registrarse (fallo de red sin compensación) siguen siendo posibles. `audit.sql` §9 los lista para revisión manual.
- Las URLs firmadas emitidas siguen siendo válidas hasta 300 s aunque se revoque una membresía.
- El PASO 2 se detiene ante políticas desconocidas: es intencional. Exige revisión humana en lugar de eliminar reglas ajenas.
