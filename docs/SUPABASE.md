# Configurar el proyecto existente

Este proyecto utiliza `Album Recuerdos` en `https://ycomlinemyhlwjaklxju.supabase.co`. No crea proyectos, buckets, tablas, usuarios ni membresías al abrir la app.

## Clave de navegador

En el panel, abre Project Settings → API Keys y copia la clave **publishable**, de prefijo `sb_publishable_`, a `VITE_SUPABASE_PUBLISHABLE_KEY` en `.env.local`. Si el panel solo tiene claves heredadas, utiliza la **anon/public** en `VITE_SUPABASE_ANON_KEY` y deja la publicable vacía. Nunca uses `service_role` ni `sb_secret_`. [Tipos de clave](https://supabase.com/docs/guides/getting-started/api-keys).

No compartas contraseñas ni pegues claves administrativas en el chat. `.env.local` está ignorado y no se copia a `dist`; aun así, los valores `VITE_*` utilizados se incorporan al frontend. Para otra URL Supabase, Vite adapta el origen de la política CSP al compilar.

## Usuarios, miembros y temas

En Authentication → Users, comprueba que existan las dos cuentas y que puedan iniciar sesión. Confirma los dos UUID reales en `public.album_members.user_id`. Cualquier cuenta adicional solo debe añadirse tras una decisión expresa; no hay una lista de correos en el código.

En la configuración de Auth desactiva **Allow new users to sign up** y los accesos anónimos. Ocultar un formulario de registro no impediría llamadas directas a la API. Conserva el acceso por correo y contraseña para los usuarios existentes.

Edita `src/config/userThemes.js`, reemplaza y descomenta los marcadores:

```javascript
export const userThemes = Object.freeze({
  'UUID_REAL_DEL_PROPIETARIO': 'blue',
  'UUID_REAL_DE_LA_ENAMORADA': 'rose',
});
```

El ejemplo anterior es un marcador, no contiene UUID reales. Cada UUID debe coincidir con su persona; el acceso se controla exclusivamente con `album_members` y RLS.

## Esquema requerido

La app consulta solo `album_members.user_id` y las seis columnas existentes de `album_photos`:

| Columna | Uso |
| --- | --- |
| `id` | UUID generado con `crypto.randomUUID()`; identifica las operaciones y reintentos |
| `storage_path` | Ruta única y obligatoria del original en `recuerdos` |
| `thumbnail_path` | Ruta de miniatura o `null` si el navegador no la pudo generar |
| `original_name` | Nombre original, representado siempre como texto |
| `uploaded_by` | UUID verificado con `auth.getUser()`; RLS debe exigir `auth.uid()` al insertar |
| `created_at` | ISO UTC de subida, enviado explícitamente; no depende de un default desconocido |

**v2:** la migración `supabase/migrations/20261106_recuerdos_v2.sql` añade `media_type`, `memory_date`, `place`, `display_path` y `duration_seconds`, y permite editar solo `memory_date` y `place`. La app funciona con y sin ella. Detalles en [Mejoras v2](MEJORAS.md).

`created_at` refleja el reloj del dispositivo. Si necesitas una hora de servidor inalterable, requiere revisar el default/trigger existente y preparar una migración posterior; no se ha supuesto ni añadido un trigger. Se mantienen las PK, FK y unicidad descritas; el script de auditoría permite comprobarlas. No hace falta una nueva columna para este diseño.

## Storage

Comprueba que `recuerdos` siga **privado**, con límite de **10485760 bytes** y MIME `image/jpeg`, `image/png`, `image/webp`. Si el panel muestra un límite decimal inferior, ajusta el límite del cliente al mismo valor o confirma el valor del bucket antes de subir fotos cercanas al máximo.

Las nuevas rutas tienen esta forma:

```text
originals/<UUID-del-usuario>/<UUID-de-la-foto>.jpg|png|webp
thumbnails/<UUID-del-usuario>/<UUID-de-la-foto>.webp
```

`upsert: false` evita sobrescrituras. Las políticas deben permitir que los dos miembros lean y eliminen estas rutas aunque el otro haya subido el archivo. Una condición de propietario en `SELECT` o `DELETE` rompería el álbum compartido. Se leen fotos antiguas con rutas relativas seguras; las rutas con traversal o caracteres de URL se rechazan para que se revisen manualmente.

Las miniaturas se procesan una por una con `createImageBitmap` o `Image`, canvas y `toBlob('image/webp')`. Si el codificador no produce WebP, la decodificación falla o la imagen supera 60 megapíxeles tras decodificarse, se conserva solo el original. La decodificación puede consumir bastante memoria antes de conocer sus dimensiones; un teléfono con poca memoria puede no procesar fotos muy grandes. La orientación depende de las API del navegador y una imagen animada aporta un único fotograma a la miniatura. Las fotos antiguas no reciben miniaturas de forma retroactiva. No se usa una función remota de transformación ni se modifica el original.

La creación de enlaces firmados usa la API de Storage para buckets privados, sin URLs públicas ni transformaciones remotas. [Archivos privados](https://supabase.com/docs/guides/storage/serving/downloads), [firma por lotes](https://supabase.com/docs/reference/javascript/storage-from-createsignedurls).

## Recuperación de contraseña

En Authentication → URL Configuration establece, durante las pruebas, Site URL como `http://127.0.0.1:5173/`. Añade estas redirecciones exactas:

```text
http://127.0.0.1:5173/?recovery=1
http://127.0.0.1:4173/?recovery=1
```

Si prefieres `localhost`, añade también esas variantes y abre la aplicación con el mismo host. Para Pages añade la URL real con su subruta y `?recovery=1`, y cambia Site URL a la URL final con barra al final. No uses comodines amplios en producción. La app deriva el destino desde `BASE_URL` y su origen actual. [Redirecciones de Auth](https://supabase.com/docs/guides/auth/redirect-urls).

El formulario solicita el correo, llama a `resetPasswordForEmail`, recibe el evento `PASSWORD_RECOVERY` y actualiza con `updateUser`. Utiliza el flujo implícito del SDK para abrir el enlace en otro dispositivo; elimina los fragmentos de autenticación del URL al procesarlos y no usa scripts de terceros. Tras guardar, cierra la sesión de este dispositivo y solicita un nuevo login. Un enlace vencido exige pedir otro. [Flujo de contraseñas](https://supabase.com/docs/guides/auth/passwords).

Configura SMTP en el panel para entregar a ambas cuentas. El servicio SMTP predeterminado tiene límites y solo envía a direcciones autorizadas del equipo; crear un usuario de Auth no lo convierte en miembro del equipo Supabase. Las credenciales SMTP se guardan exclusivamente en Supabase. La plantilla de recuperación debe conservar el enlace de confirmación que admite el flujo de Auth. [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

Antes de subir fotos personales, completa [Seguridad](SEGURIDAD.md) y las pruebas reales de [Pruebas](PRUEBAS.md).
