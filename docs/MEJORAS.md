# Mejoras v2: guía de activación y verificación

Esta versión añade seis mejoras al álbum. Todas funcionan en local y están probadas con datos simulados. **Tres de ellas requieren pasos manuales en Supabase o Cloudflare** antes de usarse en producción. Mientras no se completen, la aplicación sigue funcionando como antes.

| Mejora | ¿Funciona sin pasos externos? | Qué falta para producción |
| --- | --- | --- |
| 1. Ver u ocultar la contraseña | Sí | Nada |
| 2. CAPTCHA en el login | Queda **desactivado** | Crear el widget Turnstile, poner la sitekey y activarlo en Supabase (§3) |
| 3. Videos cortos | **No**: se ocultan hasta la migración | Ejecutar los dos pasos SQL (§2) |
| 4. Fotos optimizadas | Parcial: las fotos nuevas suben su versión optimizada cuando existe la migración; las antiguas usan su miniatura y su original | Migración (§2) |
| 5. Año, mes, lugar y tipo | Filtros por año y mes: sí (con la fecha de subida). Lugar, fecha editable y videos: tras la migración | Migración (§2) |
| 6. MIX DE RECUERDOS | Sí | Nada |

La app detecta sola si la migración existe. Sin ella usa las seis columnas originales, oculta los videos y la edición, y no sube versiones que no se puedan registrar.

## 1. Orden recomendado

1. Ejecuta `supabase/audit.sql` (solo lectura) y guarda el resultado en privado.
2. Ejecuta los dos pasos SQL de §2 y verifícalos con `supabase/verify-v2.sql`.
3. Publica el frontend (push a `main`) cuando lo autorices. La app funciona antes y después de migrar.
4. Si quieres CAPTCHA, sigue §3 **en ese orden**: primero la sitekey en el frontend y después la activación en Supabase.
5. Haz las pruebas con las dos cuentas reales (§6).

## 2. Base de datos y Storage (dos pasos)

Los detalles, permisos finales, políticas y resultados de las pruebas están en [Auditoría SQL v2](SQL_V2_AUDIT.md). Ejecuta en **Supabase → SQL Editor**, como propietario y en este orden:

| Orden | Archivo | Qué hace |
| --- | --- | --- |
| 1 | `supabase/audit.sql` | Solo lectura. Anota cuántas filas tiene `album_photos` |
| 2 | `supabase/migrations/20261106_recuerdos_v2.sql` | **PASO 1**: 5 columnas nuevas con valores neutros, restricciones CHECK, índice y `video/mp4` en el bucket. No toca filas, archivos, permisos ni políticas |
| 3 | `supabase/proposed-policies.sql` | **PASO 2**: permisos mínimos y RLS. Sustituye por nombre exacto las 8 políticas `Album members can …`, conserva la de membresía y se detiene si encuentra políticas desconocidas |
| 4 | `supabase/verify-v2.sql` | Solo lectura. Todas las filas deben mostrar `ok = true` |

Resultado:

- Las filas existentes quedan como fotografías sin fecha ni lugar. **No se modifica ni borra ninguna fila ni archivo.** El bucket sigue privado y con 10 MB.
- Ambos miembros ven, suben y borran todo el álbum, y editan **solo** `memory_date` y `place` de cualquier recuerdo.
- Cada uno sube archivos únicamente a sus carpetas (`originals/`, `thumbnails/`, `display/` + su UUID), con nombre UUID y extensiones del álbum. Nadie puede sobrescribir objetos.
- `anon` no tiene permisos en las tablas del álbum.

Ambos pasos son transaccionales (si algo falla, no se aplica nada) e idempotentes. Se probaron en PostgreSQL 18 local (PGlite) sobre una réplica del estado real informado, **no en Supabase real**.

Si el SQL Editor rechazara modificar `storage.objects` o `storage.buckets` por permisos, haz lo equivalente en **Storage → Policies** y **Storage → Buckets** (MIME: `image/jpeg, image/png, image/webp, video/mp4`; **Public bucket** desactivado; límite 10 MB) y vuelve a ejecutar `verify-v2.sql`.

En la app, tras recargar, deben aparecer el lápiz «Editar fecha y lugar» en las tarjetas y la opción «Solo videos» en el filtro Tipo.

### Revertir solo la edición de fecha y lugar (sin perder datos)

```sql
drop policy if exists album_v2_photos_update_details on public.album_photos;
revoke update (memory_date, place) on public.album_photos from authenticated;
```

No borres las columnas: contienen las fechas y lugares guardados.

## 3. CAPTCHA con Cloudflare Turnstile

**Compatibilidad verificada:** `@supabase/supabase-js 2.118.0` envía `captchaToken` en `signInWithPassword` y `resetPasswordForEmail`, y Supabase Auth valida el token **en su servidor** con la clave secreta configurada en el panel. La app nunca da por buena la verificación por su cuenta: solo envía el token.

Mientras `VITE_TURNSTILE_SITE_KEY` esté vacía, el formulario no muestra CAPTCHA y **no hay protección CAPTCHA**. Mostrar el widget sin activarlo en Supabase tampoco protege: la protección real empieza en el paso 4.

1. **Cloudflare** → Turnstile → *Add widget*. Nombre: «Nuestro Álbum». Hostnames: `rafaelcordova.github.io`, y para pruebas locales `127.0.0.1` y `localhost`. Modo recomendado: **Managed**. Copia la **Site Key** (pública) y la **Secret Key** (secreta).
2. **Frontend**: guarda la Site Key en `.env.local` como `VITE_TURNSTILE_SITE_KEY=...` y en GitHub → Settings → Secrets and variables → Actions → **Secrets** como `VITE_TURNSTILE_SITE_KEY` (el workflow ya la lee). La compilación rechaza valores que parezcan una clave secreta.
3. Publica y comprueba que el widget aparece en el login y que puedes entrar. En este punto Supabase todavía ignora el token.
4. **Supabase** → Authentication → *Attack Protection* (en algunos paneles, *Bot and Abuse Protection*) → **Enable CAPTCHA protection** → proveedor **Turnstile** → pega la **Secret Key** → Save. La clave secreta solo vive aquí.
5. Verifica: en una ventana privada el botón «Ingresar» queda desactivado hasta completar la verificación. Un token inválido o repetido devuelve «La verificación de seguridad no fue válida…» y la app pide un token nuevo. La recuperación de contraseña también exige el CAPTCHA.

Si activas el paso 4 antes del 2-3, **ninguna cuenta podrá entrar** hasta publicar la sitekey. Para desactivarlo, haz el proceso inverso: primero apágalo en Supabase y después vacía la variable.

Las sitekeys de prueba de Cloudflare (`1x00000000000000000000AA`) solo sirven para las pruebas automáticas; en producción fallarían contra una Secret Key real.

La CSP solo autoriza `https://challenges.cloudflare.com` (script y frame) cuando hay sitekey.

## 4. Videos y fotografías optimizadas: cómo funcionan

**Videos** (`originals/<usuario>/<id>.mp4` + portada `thumbnails/<usuario>/<id>.webp`):

- El navegador lee la estructura del MP4 antes de subirlo: cabecera `ftyp` de MP4 (se rechaza MOV de QuickTime), duración real en `mvhd` (máximo 15 s), pista de video H.264 y audio AAC si existe. Un archivo renombrado a `.mp4` se rechaza. Máximo 5 MB.
- No se comprime en el navegador: hacerlo exigiría FFmpeg.wasm (~25-30 MB) o un codificador WebCodecs con un multiplexor MP4, con resultados irregulares en celulares. Con 15 s y 5 MB, validar es más fiable. Si tu celular graba en HEVC, elige «Más compatible» en la cámara o exporta como MP4 H.264.
- La galería solo descarga la portada. El video se firma y descarga al abrirlo; nunca se reproduce solo y empieza con controles. En el MIX se reproduce silenciado y con un botón para activar el sonido.

**Fotos nuevas**: se conserva el original intacto y se generan dos WebP con un solo decodificado: miniatura (lado mayor 480 px, que equivale a ~320 px de ancho en fotos verticales y conserva nitidez en pantallas de alta densidad) y visualización (lado mayor 1600 px). Calidad 0,8. Todo es configurable en `src/config/media.js`. Si la versión grande no pesa menos que el original, no se sube.

**Qué carga cada vista**:

| Vista | Archivo |
| --- | --- |
| Tarjeta | Miniatura WebP (`loading="lazy"`, `decoding="async"`, proporción fija 4:3) |
| Lightbox | Miniatura difuminada al instante → versión de visualización (`display/`) |
| MIX | Versión de visualización; precarga solo la siguiente foto |
| Original | Solo como respaldo de fotos antiguas sin versión optimizada |

**Fotos antiguas**: conservan su miniatura de 640 px en la galería. En el lightbox muestran esa miniatura y después el original (respaldo seguro, como antes). En el MIX usan la miniatura. Si una foto no tiene miniatura, la tarjeta usa el original privado.

Para optimizar una foto antigua hoy: descárgala desde Storage, súbela de nuevo desde la app (ajusta fecha y lugar) y elimina la antigua. Hazlo de una en una y solo si te importa la calidad en el lightbox. Una herramienta automática exigiría permitir a los clientes modificar `display_path`; no se activó para no ampliar permisos sin tu decisión.

## 5. Variables de entorno

| Variable | Obligatoria | Dónde | Contenido |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Sí | `.env.local` y Secrets de Actions | Sin cambios |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Sí | `.env.local` y Secrets de Actions | Sin cambios |
| `VITE_BASE_PATH` | No | Workflow (`/project_album/`) | Sin cambios |
| `VITE_TURNSTILE_SITE_KEY` | No | `.env.local` y Secrets de Actions | **Nueva.** Sitekey pública de Turnstile |

La Secret Key de Turnstile **no** es una variable del proyecto: se pega solo en el panel de Supabase.

## 6. Pruebas manuales con las dos cuentas

Usa recuerdos de prueba que puedas borrar.

| Prueba | Resultado esperado |
| --- | --- |
| Pulsar el ojo en el login, en el celular y con teclado (Tab + Enter) | Muestra y oculta sin borrar; el login funciona igual |
| Subir un MP4 H.264 de menos de 15 s desde cada cuenta | Vista previa, botón Cancelar, barra de progreso, portada con «▶ N s» |
| Subir un MP4 de 20 s, uno de más de 5 MB y un MOV | Mensajes claros; nada se sube |
| Abrir el video desde la otra cuenta | Se reproduce con controles; no arranca solo |
| Editar fecha y lugar de un recuerdo del otro | Cambia de mes en la galería en ambas cuentas tras «Actualizar» |
| Filtros Año → Mes → Lugar → Tipo y «Ver todos» | Muestra solo lo que corresponde |
| MIX DE RECUERDOS | Separadores por mes, avanzar/retroceder, pausa, velocidad, cerrar con X o Esc |
| Eliminar una foto nueva del otro | Se borran original, miniatura y `display/` (compruébalo en Storage) |
| `npm run check:remote` | Todo ✔: sin sesión no se leen filas ni archivos ni se firman URLs |
| Ventana privada sin sesión | Formulario; sin acceso a fotos ni videos |

`npm run check:remote` usa solo la clave publicable, sin sesión, y no escribe nada. No sustituye las pruebas de `docs/PRUEBAS.md` con una cuenta autenticada sin membresía.

## 7. Limitaciones conocidas

- **Límites de video en el servidor**: Supabase aplica el límite del bucket (10 MB) a todos los archivos y no permite un límite distinto por tipo. Los 5 MB y 15 s se validan en el navegador; la base de datos además rechaza `duration_seconds > 15`, pero ese valor lo informa el cliente. El tipo MIME que comprueba el bucket es el declarado en la subida, no el contenido. Un miembro malintencionado con herramientas propias podría subir un MP4 de hasta 10 MB; dado que solo hay dos miembros de confianza, el riesgo es bajo.
- La validación de MP4 comprueba estructura, códecs y duración, pero no garantiza que todos los fotogramas se puedan decodificar.
- Los videos HEVC o MOV se rechazan para garantizar que se reproduzcan en todos los navegadores.
- Una URL firmada dura 300 s. Si un video queda en pausa más tiempo, al reanudar se firma de nuevo una vez y continúa desde la misma posición.
- La fecha de respaldo de los recuerdos sin fecha es la de subida, en la zona horaria del dispositivo, y se muestra como «Subida el …». Nunca se inventa una fecha.
- Los metadatos (unos cientos de bytes por recuerdo) se cargan completos para filtrar; las imágenes se firman y descargan solo para las tarjetas visibles, de 48 en 48.
- El CAPTCHA requiere cargar el script de Cloudflare; un bloqueador de contenido puede impedirlo. La app lo indica y ofrece reintentar.
