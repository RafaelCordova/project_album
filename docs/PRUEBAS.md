# Verificación y pruebas pendientes

## Comandos reproducibles

```powershell
npm ci
npm run check
npm test
npm run test:e2e
npm run build
npm run check:dist
npm run test:build
npm audit --omit=dev
```

Las pruebas E2E usan Chrome ya instalado en Windows. En otro sistema instala Chromium para Playwright antes de ejecutarlas con `npx playwright install chromium`. El runner abre Vite en `127.0.0.1:5174/prueba-album/` y lo cierra al terminar. No ejecutes otro servidor en ese puerto. Los tokens, cuentas y claves de pruebas son fixtures ficticios; todas las solicitudes a Supabase están interceptadas. No configures datos reales dentro de los tests. No prueban RLS remoto.

`check` usa `node --check` sobre JavaScript, no requiere un linter adicional. `test` comprueba compensación, respuestas ambiguas de INSERT, conflictos, eliminación parcial, rutas, firmas de archivos, rechazo de claves administrativas, lote de URLs, vencimiento y limpieza de caché entre sesiones. E2E recorre login, no miembro, subida con miniatura WebP, persistencia de sesión, lightbox, cancelación/eliminación y reintento, recuperación y móvil sin desbordamiento. También comprueba que un nombre con HTML se represente como texto y que los estilos se apliquen.

`test-results/` contiene capturas y trazas de Playwright; está ignorado y no se publica. Las capturas usan exclusivamente datos simulados. La verificación final ejecutada en esta entrega figura en `VERIFICACION.md`.

La suite incluye la matriz de 16 tamaños y los escenarios adicionales de `RESPONSIVE.md`. Las pruebas de diseño guardan capturas explícitas y desactivan trazas; las pruebas funcionales conservan trazas cuando fallan. La ejecución completa tiene un límite de cinco minutos para que el job de CI no quede activo indefinidamente.

`test:build` sirve `dist` en el puerto 4175 y comprueba con Chrome/Chromium la entrada, JS, CSS, favicon, estilos aplicados y ausencia de errores de consola. Respeta la subruta compilada, no inicia sesión y bloquea cualquier petición HTTPS externa. Cierra el servidor al terminar. Requiere haber ejecutado `npm run build`.

## Con las dos cuentas reales

El propietario confirmó la conexión y la configuración pública local pasa la validación. Las pruebas reales de abajo siguen siendo manuales: el agente no ha iniciado sesión con tus cuentas ni ha verificado RLS remoto. Usa fotos de prueba que estés dispuesto a borrar.

| Prueba | Resultado esperado |
| --- | --- |
| Abrir sin sesión y en ventana privada | Formulario; ninguna consulta a fotos desde la app |
| Contraseña incorrecta | Error comprensible, sin galería |
| Entrar con propietario | Galería común y tema azul al configurar su UUID |
| Entrar con enamorada en otro navegador/dispositivo | Mismas fotos y tema rosa al configurar su UUID |
| Recargar cada dispositivo | Sesión recuperada por el SDK |
| Cuenta miembro sin tema | Tema neutral |
| Subir JPEG, PNG y WebP desde ambos | Dos objetos por foto procesable y una fila con `uploaded_by` correcto |
| Subir un archivo de más de 10 MB, SVG o PNG renombrado | Se rechaza sin crear filas ni archivos |
| Revisar original en Storage | Bytes idénticos al archivo de entrada; nunca se sobreescribe |
| Revisar miniatura | WebP, proporción conservada, lado mayor hasta 640 px |
| Imagen que el navegador no procesa | Conserva original, `thumbnail_path = null` y aviso |
| Abrir desde otro dispositivo | Puede firmar miniatura y original de cualquier miembro |
| Mantener abierta más de 5 minutos, suspender y volver | Se renuevan URLs y las fotos se siguen viendo con conexión |
| Cancelar eliminación | No se borra nada |
| Eliminar foto de la otra persona | Original, miniatura y fila eliminados; la otra persona ve el cambio al Actualizar |
| Recuperar contraseña | Correo entregado, redirección exacta, cambio de contraseña y nuevo login |
| Cerrar sesión y recargar | Sin galería ni sesión local; no cierra el navegador de la otra persona |

El límite de 10 MiB del cliente debe coincidir con el valor efectivo del bucket. Prueba también valores cercanos al límite. La firma de bytes no garantiza que una imagen esté completamente decodificable ni libre de contenido malicioso.

## Autorización directa, aparte de la interfaz

Estas comprobaciones son obligatorias para poder declarar seguro el proyecto. Usa un cliente separado con la clave publicable y sin sesión, y un token de usuario de prueba cuando se indique. Nunca uses una clave administrativa: el SQL Editor como propietario omite RLS y no demuestra los permisos de un visitante.

1. Con clave publicable sin sesión, intentar SELECT/INSERT/DELETE sobre ambas tablas y listar/firmar/subir/eliminar objetos en `recuerdos`: ninguna operación debe exponer ni modificar datos. SELECT puede devolver `[]` o error según los grants.
2. Con un usuario autenticado que no sea miembro, repetir esas operaciones: todas deben denegarse. Solo si puedes usar una cuenta de prueba ya autorizada por el propietario; no habilites registro público para probar.
3. Como miembro, intentar insertar una fila con `uploaded_by` de la otra persona: debe denegarse. Intentar modificar membresías y rutas de metadatos: debe denegarse.
4. Como ambos miembros, leer, subir y eliminar una foto del otro: debe permitirse. En Storage confirmar permisos SELECT además de DELETE.
5. Abrir la ruta pública de un objeto conocido sin URL firmada ni sesión: debe fallar. No hagas público el bucket para corregirlo.
6. Verificar que un enlace firmado emitido puede funcionar hasta vencer, y que ya vencido no permite nuevas descargas. Un recurso ya descargado puede seguir en caché del navegador.
7. Revisar que no existan RPC, vistas o grants que permitan añadir miembros, cambiar `uploaded_by`, cambiar rutas o leer fotos sin membresía.

## Fallos y concurrencia

Las pruebas automáticas reproducen errores importantes con mocks. Para revisar el sistema real, puedes cortar la red desde DevTools después de subir un archivo o bloquear temporalmente la petición de metadatos en un entorno controlado. No alteres políticas de producción ni borres fotos ajenas para simular fallos.

Comprueba que no se pierdan archivos de un INSERT confirmado cuya respuesta se haya perdido; que una limpieza fallida muestre la referencia; y que un DELETE de metadatos fallido conserve un registro reintentable. Revisa `audit.sql` para reconciliar después. Si dos personas suben simultáneamente, los UUID evitan colisiones; Actualizar permite corregir desplazamientos de página por nuevas inserciones. Una selección de 10 fotos no es una transacción: cada una puede tener éxito o fallar de forma independiente.
