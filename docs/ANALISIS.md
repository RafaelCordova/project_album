# Informe de análisis — "Nuestro Álbum"

**Contexto:** se pidió un análisis completo del código (src/, tests/, supabase/, scripts/, configuración) **sin modificar nada**. Este documento es el entregable; no hay pasos de implementación. Archivos leídos completos: los 15 de `src/` (incluido CSS), los 7 de `tests/`, los 2 SQL, los 5 scripts, `vite.config.js`, `playwright.config.js`, `package.json`, `index.html`, `.github/workflows/pages.yml`, `.gitignore`, `.env.example`. También se revisó el código de `@supabase/auth-js` en node_modules para confirmar un bug (signOut → evento `SIGNED_OUT`).

---

## 1. Qué hace la app y cómo fluye

App estática (Vite, JS sin framework) para **dos cuentas** de Supabase que comparten un álbum privado. No tiene backend propio: Auth, PostgreSQL (`album_members`, `album_photos`) y un bucket privado `recuerdos`.

**Arranque** (`src/main.js:441-455`)
1. `config/supabase.js` llama a `readConfig(import.meta.env)`. Si falta la URL o la clave → pantalla "Preparemos nuestro álbum" y fin.
2. Si está lista: crea los servicios `auth`, `storage`, `photos` y se suscribe a `onAuthStateChange` (diferido con `setTimeout` para salir del bloqueo de Auth).
3. `applySession(await auth.session())`, y un intervalo de 30 s (más `focus`/`online`/`visibilitychange`) que llama a `renewImages()` para renovar las URLs firmadas.

**Sesión** (`applySession`, `main.js:100-137`)
- Sin sesión → limpia el estado privado y muestra el login (`authView`). Si la URL traía un error o era de recuperación → aviso "enlace no válido".
- Sesión de recuperación (`?recovery=1` o `#type=recovery` o evento `PASSWORD_RECOVERY`) → formulario de nueva contraseña.
- Sesión normal → "Comprobando tu acceso…" → `auth.member()` (`getUser()` y luego `album_members` con `user_id = uid`). Si no es miembro → mensaje de error con "Volver a comprobar"/"Cerrar sesión". Si es miembro → aplica el tema por UUID, `showAlbum()` y `loadPhotos()`.

**Galería** (`loadPhotos`, `main.js:227-251`)
- Vuelve a comprobar la membresía, `photos.list(offset)` (48 por página, ordenado `created_at desc, id desc`), firma las URLs de las miniaturas (o del original si no hay miniatura o falla su firma) con `galleryUrls()` y dibuja con `renderGallery()`.
- El lightbox firma el original solo cuando se abre (`openLightbox`).

**Subir** (`uploadFiles` → `photoService.upload`)
1. Máx. 10 archivos. Por cada uno: `validateFile` (MIME + extensión + ≤10 MB) → `validateImageSignature` (bytes mágicos).
2. `getUser()`, genera un UUID y las rutas `originals/<uid>/<id>.<ext>` y `thumbnails/<uid>/<id>.webp`.
3. Miniatura WebP de ≤640 px en canvas (puede salir `null`).
4. Sube el original, luego la miniatura, e inserta la fila.
5. Si algo falla: si el INSERT llegó a intentarse, vuelve a leer la fila (por si se guardó y solo se perdió la respuesta). Si no existe, borra los archivos subidos. Si la limpieza falla, muestra el id y las rutas para reconciliar a mano.
6. Al terminar, `loadPhotos()`.

**Borrar** (`confirmDelete` → `photoService.remove`)
1. Diálogo de confirmación. `getPhoto(id)` vuelve a leer la fila (no se fía de las rutas del DOM) → `assertStoragePath`.
2. Comprueba que ninguna otra fila use esas rutas → borra los archivos en Storage (y verifica con `exists()` los que la respuesta no confirmó) → `DELETE` de la fila filtrando por `id` y `storage_path`.
3. Si el DELETE no borra nada, vuelve a leer: si la fila sigue → error "registro pendiente"; si no está → otra persona ya la borró, se da por bueno.

---

## 2. Arquitectura

| Archivo | Responsabilidad | Depende de |
|---|---|---|
| `index.html` | Shell, CSP en `<meta>` con el marcador `__SUPABASE_ORIGIN__`, `#app` y `#notifications` | — |
| `vite.config.js` | Lista de `VITE_*` permitidas, valida la config con `readConfig`, valida `base`, plugin que inyecta el origen en la CSP (y en dev abre `ws:` para HMR) | `environment.js` |
| `src/config/environment.js` | `readConfig`: rechaza `sb_secret_`, JWT con rol distinto de `anon` y URL que no sea un origen HTTPS limpio. Se usa en runtime y en build | — |
| `src/config/supabase.js` | `createClient` (sesión persistente, flujo **implicit**, `storageKey` propio) | environment |
| `src/config/userThemes.js` | Mapa UUID → tema | — |
| `src/main.js` (457 líneas) | Coordinador: `state` global, ciclo de sesión, construcción de **toda** la vista del álbum, lightbox, diálogo de borrado, subida, renovación de URLs | todo |
| `src/services/authService.js` | session/member/signIn/signOut(local)/recover/updatePassword | client |
| `src/services/photoService.js` | list/upload/remove con compensaciones, `PHOTO_COLUMNS`, `PAGE_SIZE` | client, storage, imageService |
| `src/services/storageService.js` | `assertStoragePath`, subida, borrado verificado, caché de URLs firmadas (lotes de 100, 300 s, contador `generation` contra respuestas viejas) | client |
| `src/services/imageService.js` | Validación de tipo, tamaño y firma de bytes; `createThumbnail` (canvas → WebP) | — |
| `src/utils/errors.js` | `AlbumError` (con `details`) y `friendlyError` (mensajes en español con regex) | — |
| `src/components/ui.js` | `element`, `button`, `icon` (SVG estáticos), `notify`, `formatDate`, `brand` | — |
| `src/components/authView.js` | Pantallas login / recuperar / nueva contraseña | ui |
| `src/components/gallery.js` | Rejilla de tarjetas o estado vacío | ui |
| `src/styles/*.css` | Estilos y variables de los 3 temas | — |
| `scripts/*` | check (sintaxis), check-config, check-dist (escaneo de secretos), e2e (Vite en 5174 + Playwright), smoke-build | vite, playwright |
| `supabase/*.sql` | Auditoría de solo lectura y propuesta de políticas **no aplicada** | — |
| `.github/workflows/pages.yml` | Build y deploy a Pages | — |

Patrón clave: `state.revision` se incrementa al cerrar sesión o cambiar de usuario, y cada flujo asíncrono compara la revisión antes de escribir resultados. `storageService` tiene su propio `generation` para lo mismo.

---

## 3. Bugs probables

| # | Severidad | Ubicación | Problema |
|---|---|---|---|
| B1 | **Media (confirmado)** | `main.js:61-66` + `main.js:448` + `main.js:33` | **El aviso "Contraseña actualizada…" desaparece al instante.** `auth.signOut()` emite `SIGNED_OUT` (`_removeSession` → `_notifyAllSubscribers`), y el listener agenda `applySession(null)` con `setTimeout`. `signOut()` termina, se llama a `notify(...)` y después se ejecuta el timeout: `clearPrivateState()` vacía `#notifications`. Además, **cada cierre de sesión dibuja el login dos veces** (`signOut` → `showAuth`, y otra vez desde `applySession(null)`), lo que puede borrar lo que el usuario ya empezó a escribir. |
| B2 | Media | `main.js:419-438` (`renewImages`) | Condición de carrera con `loadPhotos`: `renewImages` solo se salta si `state.loading` ya está activo al empezar. Si arranca antes y durante su `await` un "Actualizar" cambia `state.photos`, (a) en `:430` `photo` puede ser `undefined` → `TypeError` que se traga el `catch` y deja de actualizar el resto de imágenes; (b) en `:427` `state.urls = urls` pisa el mapa más nuevo con uno viejo. Tampoco comprueba `state.busy`. |
| B3 | Media | `imageService.js:25-34` | El límite de 60 MP se comprueba **después** de decodificar con `createImageBitmap`. Un PNG o JPEG de ≤10 MB con dimensiones enormes (p. ej. 20 000×20 000) se decodifica entero (~1,6 GB) y puede colgar la pestaña, sobre todo en móvil. |
| B4 | Media | `main.js:154` | "Cambiar contraseña" desde el álbum pone `state.recovery = true`. No hay forma de volver al álbum: el botón alternativo es "Cerrar sesión" (`main.js:41`). Además, un `TOKEN_REFRESHED` en ese momento entra por la rama de recuperación (`:112`) y vuelve a dibujar el formulario, perdiendo lo escrito. Al guardar, se fuerza el cierre de sesión. |
| B5 | Baja-media | `main.js:298` (`uploadFiles`) | Después de subir se llama a `loadPhotos()` sin `append`, así que se descartan las páginas ya cargadas con "Ver más": el usuario vuelve a la primera página de 48. |
| B6 | Baja | `main.js:242-245` | Paginación por offset: si la otra persona borra fotos entre páginas, se **salta** alguna (los duplicados sí se eliminan con el `Map`). Si el total es múltiplo exacto de 48, aparece "Ver más" y no trae nada (`:245`). |
| B7 | Baja | `photoService.js:55` | `created_at` lo pone el reloj del cliente: un reloj desfasado desordena la galería, y el usuario puede fijar cualquier fecha. |
| B8 | Baja | `main.js:194`, `:264` | Soltar archivos mientras `state.loading` está activo no hace nada y no avisa. `dragleave` en elementos hijos hace parpadear `.drag-over` (`:193`). |
| B9 | Baja | `photoService.js:49-52` | Si falla solo la subida de la miniatura (sin conflicto), se descarta también el original. Se podría seguir con `thumbnail_path = null`, igual que cuando no se genera miniatura. |
| B10 | Baja | `storageService.js:55` | Depende de `client.supabaseUrl`, un campo interno de supabase-js (hoy existe, `index.mjs:640`). Es frágil ante actualizaciones; mejor inyectar `config.url`. |
| B11 | Baja | `main.js:449-450` + listener `:448` | Al arrancar, `applySession` se ejecuta dos veces (llamada directa y evento `INITIAL_SESSION`). Sin sesión, el login se dibuja dos veces (mismo efecto que B1). |
| B12 | Baja | `ui.js:40-49` | Los avisos de error nunca se cierran solos y se acumulan. Tienen `role="alert"` dentro de un contenedor `aria-live`, así que se pueden anunciar dos veces. El icono de error es `image`. |

Revisado y **descartado**: un `signOut` sin conexión no deja la sesión abierta, porque auth-js borra la sesión local aunque devuelva error y luego emite `SIGNED_OUT`.

---

## 4. Seguridad

**Lo que está bien:** no hay `innerHTML` con datos de Supabase (los nombres se tratan como texto y hay test E2E de XSS); `assertStoragePath` en toda ruta leída; se comprueba el origen de las URLs firmadas; el borrado vuelve a leer la fila; en build se bloquean claves `sb_secret_` y `service_role`; lista de `VITE_*` permitidas; `check-dist`; CSP con `default-src 'none'`; `referrer no-referrer`; bucket privado con URLs de 300 s.

| # | Severidad | Tema | Detalle |
|---|---|---|---|
| S1 | **Alta** | RLS/Storage sin verificar | Toda la autorización real depende de políticas en Supabase que **no se han auditado** (`proposed-policies.sql` no está aplicado). La comprobación de `album_members` en el cliente es solo de interfaz: con la clave publicable, cualquier cuenta autenticada del proyecto puede llamar a la REST API directamente. Si las políticas actuales son permisivas, otra cuenta podría leer o borrar fotos. Primer paso: ejecutar `audit.sql`. |
| S2 | Alta | Validación de archivos solo en el cliente | Tipo, tamaño y firma se validan en el navegador; el `contentType` lo envía el cliente. Hay que confirmar en el bucket `file_size_limit = 10485760` y `allowed_mime_types` = jpeg/png/webp (lo revisa `audit.sql` punto 6). Sin eso, una cuenta podría subir HTML o SVG (se servirían desde el origen de Supabase, no desde la app; riesgo bajo, pero conviene cerrarlo). |
| S3 | Media | Propuesta de políticas | (a) No exige que el UUID del nombre de archivo coincida con `id` de la fila (`proposed-policies.sql:44-45`), lo que permite que varias filas apunten a un mismo archivo; la app lo compensa en `remove`, pero sería mejor cerrarlo en BD. (b) `created_at` y `original_name` sin restricción: no hay límite de longitud ni `default now()`. (c) Las regex aceptan `.jpeg` y `thumbnails/*.png`, que la app nunca genera. (d) Cualquier miembro puede borrar fotos del otro (es intencional; confirmarlo). |
| S4 | Media | Cambio de contraseña | `updatePassword` + `signOut({ scope: 'local' })` deja **abiertas las sesiones en otros dispositivos**. Tras cambiar la contraseña (sobre todo después de una recuperación), conviene `scope: 'global'` o `'others'`. Tampoco se traduce el error `reauthentication_needed` si el proyecto exige reautenticación. |
| S5 | Media | Flujo implicit | `flowType: 'implicit'` (`supabase.js:10`) deja los tokens en el fragmento de la URL. Se limpia con `replaceState` y hay `no-referrer`, pero PKCE es la opción recomendada. Está justificado en el comentario (recuperación desde otro dispositivo). Es un compromiso aceptable si se documenta. |
| S6 | Media | Despliegue sin controles | `pages.yml` no ejecuta `check:config`, `check:dist` ni los tests. Si faltan los secrets, el build **pasa** y publica la pantalla "falta configuración". Un fallo de `check-dist` nunca bloquearía el deploy. |
| S7 | Baja | CSP en `<meta>` | `frame-ancestors` no funciona en `<meta>` y GitHub Pages no deja poner cabeceras, así que se puede embeber la app en un iframe (clickjacking, p. ej. sobre "Sí, eliminar"). Mitigación posible: comprobar `window.top !== window.self` en JS. |
| S8 | Baja | Privacidad | Los UUID reales de los dos usuarios están en el bundle público (`userThemes.js`). Las fotos originales se suben con su EXIF (incluido el GPS). Los avisos de error muestran rutas con el UUID (`main.js:291`; solo a la persona autenticada). |
| S9 | Baja | Tests contra el ref real | `e2e.mjs:7`, `fixtures.js:5` y `vite.config.js:11` usan el ref real del proyecto. Si a un test le falta un fixture, la petición podría salir al proyecto real (con clave falsa, así que fallaría). Mejor usar `https://example.supabase.co`. |
| S10 | Info | `.gitignore:5` | `.env.*` está ignorado y `!.env.example` está permitido; bien. `CLAUDE.md` también está ignorado (`.gitignore:18`), así que no se versionará. |

---

## 5. Código duplicado, muerto o difícil de mantener

- **Código muerto:** `storageService.forget()` (`storageService.js:19`) no se usa en ningún sitio.
- **Duplicados:**
  - `photo.thumbnail_path || photo.storage_path` aparece en `gallery.js:26`, `main.js:254` y `main.js:430` → convendría un helper `previewPath(photo)`.
  - `validateFile` se llama dos veces por archivo (`main.js:281` y dentro de `validateImageSignature`).
  - El ref del proyecto Supabase está repetido en 4 sitios (más README y docs).
  - El generador de imagen en canvas de `album.spec.js:35-43` duplica `fixtureImage()` de `fixtures.js`.
  - `themeFor` vuelve a validar contra `['blue','rose']` lo que ya define el mapa congelado.
  - En `gallery.js:15-17` se crea el botón con una etiqueta y acto seguido se borra con `replaceChildren()`.
- **Inconsistencias:** `innerHTML` estático en `main.js:168` y `authView.js:9,20,22-23`. Es seguro, pero contradice la convención "sin plantillas innerHTML". `.env.example:7` dice que el workflow deduce la base, pero está fija en `/project_album/` (`pages.yml:37`). `pages.yml` empieza con BOM UTF-8.
- **Difícil de mantener:**
  - `main.js` mezcla estado, sesión, construcción de vistas (`showAlbum` tiene ~70 líneas, `createDialogs` ~50) y lógica de negocio. Como no tiene inyección de dependencias ni exports, no se puede probar con tests unitarios.
  - Líneas muy largas con varias sentencias (`main.js:14, 141, 240, 401`; `authView.js:9`).
  - `state.identity` y `state.user` se solapan.
  - El nombre `signing` es confuso (significa "renovando URLs").
  - Los listeners se reasignan con `remove.onclick` en cada confirmación.
- **CSS:** muchos textos de 7-10 px (`.brand-subtitle`, `.eyebrow`, `.privacy-note`, etc.); conviene revisar la legibilidad y la accesibilidad.

---

## 6. Cobertura de tests

**Unitarios (`node:test`):**
- **photos.test.js:** las columnas exactas; subida con rutas distintas y `uploaded_by`; subida sin miniatura; limpieza si falla el INSERT; INSERT ambiguo con la fila guardada y sin poder verificar; conflicto 409 sin limpiar; fallo de la limpieza con `details`; orden del borrado (Storage antes que la fila); fallo de Storage al borrar; fallo del DELETE de la fila; ruta insegura y referencias compartidas.
- **storage.test.js:** lotes de 100, deduplicado y caché; `force`; renovación antes de vencer; `clear()` frente a una respuesta pendiente; origen ajeno; DELETE silencioso por RLS; archivo ausente.
- **security.test.js:** `readConfig` (secret, `service_role`, http), tema neutral, `validateFile`/firma, `assertStoragePath`.

**E2E (Playwright con un backend falso):** login con error, no-miembro sin pedir fotos, flujo completo (subida → recarga → lightbox → cancelar/confirmar borrado → salir), reintento tras fallo del DELETE de la fila, respaldo al original si falta la miniatura, recuperación con subruta y nueva contraseña, XSS en nombres, 16 resoluciones × 3 temas, cola de errores, áreas táctiles y rotación.

**Sin cubrir:**
- `authService` sin tests unitarios (membresía, `redirectTo` de recuperación, `signOut`).
- `friendlyError`: ningún test del mapeo de mensajes.
- `photoService.list` (orden y rango: el mock ignora `order`, `range` y `limit`); `getPhoto` con UUID inválido; `remove` cuando la fila no existe; borrado concurrente (el DELETE devuelve 0 filas y la fila ya no está); subida sin usuario; 409 en la miniatura.
- El mock trata `single()` y `maybeSingle()` igual (`helpers.js:19-20`); con 0 filas, `single()` debería dar error.
- `readConfig`: URL con ruta, query o credenciales; clave con formato desconocido; marcador `COPIA_AQUI`; JWT malformado.
- `storageService`: `upload`, `exists()` con error distinto de 404, error por elemento en `createSignedUrls`.
- `createThumbnail`: nada (solo funciona en navegador; se podría cubrir con E2E).
- `main.js`: paginación "Ver más", límite de 10 archivos, arrastrar y soltar, errores de subida mostrados en la interfaz, teclado en el lightbox, `renewImages`, `imageFallback`, revocar la membresía a mitad de sesión, cambiar contraseña desde el álbum hasta el final, tema según el UUID (en el test se fija a mano), y el aviso tras cambiar contraseña (por eso no se detectó B1).
- Nada prueba `vite.config.js` (lista de variables, regex de `base`, plugin de CSP), `check-dist.mjs` ni `check-config.mjs`. La CSP real del build solo se ejercita en `smoke-build`, sin login.
- La CI no ejecuta ningún test.
- `globalTimeout: 300_000` puede quedarse corto con las 16 resoluciones en una máquina lenta.

---

## 7. Mejoras priorizadas

### Alta
1. **Auditar Supabase:** ejecutar `supabase/audit.sql` (lo hace el propietario, a mano) y decidir qué políticas aplicar; confirmar el bucket privado con límite de tamaño y MIME (S1, S2).
2. **CI con controles:** en `pages.yml`, añadir `npm run check`, `npm test`, `npm run check:config` (que falle si faltan los secrets) y `npm run check:dist` antes de subir el artefacto. Decidir la base: fija o `/${{ github.event.repository.name }}/` (S6).
3. **Corregir B1/B11:** que el cierre de sesión pase por un solo camino. Por ejemplo, `signOut()` solo llama a `auth.signOut()` y deja que `applySession(null)` limpie la interfaz; el aviso se muestra después, o se pasa como parámetro para que sobreviva a la limpieza.
4. **Cerrar las demás sesiones al cambiar la contraseña** (`scope: 'global'` o `'others'`) (S4).

### Media
5. Comprobar las dimensiones antes de decodificar entera la imagen (leer la cabecera PNG/JPEG o usar `createImageBitmap` con `resizeWidth`) (B3).
6. Que `renewImages` respete `state.busy`, aguante que `photo` sea `undefined` y no sobrescriba `state.urls` si cambiaron las fotos mientras esperaba (B2).
7. Cambiar contraseña desde el álbum: botón "Volver al álbum", no usar `state.recovery` para este caso e ignorar `TOKEN_REFRESHED` en ese modo (B4).
8. Endurecer la propuesta SQL: el nombre de archivo debe coincidir con `id`, `created_at default now()` (y que el cliente no lo envíe), límite de longitud en `original_name` (S3, B7).
9. Tests: unitarios para `authService` y `friendlyError`; `mockClient` que respete `range`/`order`/`single`; E2E para el aviso tras cambiar contraseña, "Ver más", el límite de 10 y un fallo de subida en la interfaz.
10. Dividir `main.js` en `components/albumView.js`, `lightbox.js` y `confirmDialog.js`, con un coordinador que se pueda probar.

### Baja
11. Tras subir, insertar las fotos nuevas en `state.photos` en vez de recargar solo la primera página (B5). Paginar por cursor (`created_at`, `id`) en lugar de offset (B6).
12. Si falla solo la miniatura, conservar el original (B9). Inyectar el origen de Supabase en `storageService` (B10).
13. Defensa contra iframes en JS (S7). Quitar el EXIF/GPS opcionalmente (S8). Usar `example.supabase.co` en los tests (S9).
14. Limpieza: borrar `forget()`, helper `previewPath`, reutilizar `fixtureImage`, quitar la doble validación, cambiar los `innerHTML` estáticos por `element()`, partir las líneas largas, corregir `.env.example:7`, quitar el BOM de `pages.yml`.
15. Interfaz y accesibilidad: avisos de error con tope o autocierre, icono propio de error, aviso al soltar archivos durante una carga, tamaños mínimos de texto.

---

## Verificación
No hay cambios que verificar (solo análisis). Para confirmar B1 a mano: `npm run dev`, entrar, "Cambiar contraseña", guardar → el aviso verde desaparece enseguida. Para S1/S2: el propietario ejecuta `supabase/audit.sql` en el SQL Editor (es de solo lectura) y compara con `proposed-policies.sql`.
