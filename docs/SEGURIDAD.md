# Seguridad y revisión pendiente de RLS

## Qué se conoce y qué falta

Se recibió el esquema de dos tablas y la descripción de políticas iniciales, sin sus expresiones, privilegios ni nombres. No se tiene una conexión administrativa al proyecto y no se ejecutó SQL remoto. Por ello **la seguridad real de las políticas todavía no está verificada**. La configuración pública local ya pasa la validación y el propietario confirmó la conexión. Esto no prueba los permisos de visitantes ni de cuentas ajenas. No hay una vulnerabilidad remota demostrada ni se ha declarado seguro el entorno por suposición.

El frontend exige una sesión y comprueba la membresía para decidir qué mostrar. Eso mejora la interfaz; la protección de las API se debe comprobar aparte. [RLS de Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Auditoría manual antes de producción

Abre `supabase/audit.sql` en el SQL Editor como propietario y ejecuta el archivo completo. Es de solo lectura y termina con `rollback`. Revisa:

1. Las columnas, PK, FK de `uploaded_by` a `auth.users`, y `UNIQUE(storage_path)` coinciden con el esquema informado. `thumbnail_path` admite `null`.
2. RLS está activo en `album_members`, `album_photos` y `storage.objects`.
3. Solo los dos UUID previstos están en `album_members`. Los clientes `anon` y `authenticated` no pueden insertar, actualizar ni eliminar miembros.
4. Un miembro puede consultar su membresía; evita una política de `album_members` que consulte recursivamente esa misma tabla. La lectura de su propia fila basta para esta aplicación.
5. `album_photos`: SELECT, INSERT y DELETE exigen membresía; INSERT exige además `uploaded_by = auth.uid()`. No hace falta UPDATE. `anon` no debe tener permisos efectivos. Los clientes no deben tener TRUNCATE, TRIGGER ni privilegios heredados para eludir RLS.
6. `storage.objects`: SELECT, INSERT y DELETE de `recuerdos` exigen membresía. INSERT limita el bucket y las rutas; ambos miembros pueden leer y eliminar todo el álbum. No se necesitan UPDATE ni upsert. Storage requiere SELECT y DELETE para eliminar. [API remove](https://supabase.com/docs/reference/javascript/storage-from-remove).
7. No hay políticas `USING (true)`, `WITH CHECK (true)` ni permisos generales que expongan este bucket o los metadatos. Revisa TODAS las políticas de Storage: una política para todos los buckets también puede afectar este.
8. El bucket sigue privado y mantiene sus límites. Revisa las funciones SECURITY DEFINER/RPC, vistas y triggers accesibles a los clientes; podrían ejecutar operaciones con privilegios superiores. Un nombre seguro de función no acredita seguridad.

Las políticas permisivas se combinan con **OR**: agregar otra más estricta no elimina una existente demasiado amplia. Las restrictivas se combinan con **AND**, pero necesitan al menos una política permisiva que autorice la operación. La propuesta agrega un límite restrictivo además de permisos concretos.

`supabase/proposed-policies.sql` es una **propuesta para revisión, no aplicada**. No borra datos ni recrea tablas; revoca privilegios de cliente y agrega políticas. Debe compararse con la auditoría y autorizarse antes de ejecutarla. Puede romper otros clientes que dependan de editar metadatos o miembros. No elimina políticas desconocidas ni corrige automáticamente funciones, vistas o roles heredados. Si hay políticas restrictivas antiguas de propietario, deben prepararse cambios por sus nombres reales en una migración autorizada. Guarda las definiciones y grants actuales para poder revertir cambios. No ejecutes esta propuesta a ciegas ni añadas una clave administrativa al frontend para resolver permisos.

## Tratamiento de archivos y fallos parciales

No existe una transacción única entre la API de Storage y PostgREST. Se implementa este orden:

| Operación / fallo | Comportamiento |
| --- | --- |
| Subida normal | Valida, genera miniatura, sube original y miniatura, luego inserta metadatos |
| El navegador no procesa la miniatura | Conserva el original y registra `thumbnail_path = null`; informa que usará el original |
| Falla una subida | Intenta quitar las rutas de ese intento; nunca limpia un objeto que respondió conflicto 409 |
| Falla la respuesta de INSERT | Consulta el UUID antes de limpiar: si la fila con la misma ruta y usuario existe, da por guardado el recuerdo |
| INSERT no confirmado y la consulta también falla | Conserva archivos por seguridad y muestra una referencia; exige actualizar antes de repetir |
| INSERT falló sin fila | Elimina archivos del intento; si la limpieza falla, muestra el UUID y las rutas para revisión |
| Eliminación normal | Vuelve a leer la fila, comprueba rutas y referencias compartidas, elimina los objetos y después la fila |
| Storage falla o filtra DELETE silenciosamente | Conserva la fila para reintentar; verifica existencia de rutas no incluidas en la respuesta de eliminación |
| Falla eliminar la fila después de Storage | Conserva el registro y muestra el reintento; Storage admite objetos ya ausentes con respuesta 404 |
| Otra persona ya eliminó la fila | La operación es idempotente y se considera terminada |

La API de eliminación solo recibe un UUID desde la UI. Obtiene sus rutas de la fila protegida por RLS y opera exclusivamente en `recuerdos`. Rechaza URLs absolutas, traversal, codificación de rutas y referencias usadas por otra fila. Los metadatos deben ser inmutables para clientes: una modificación simultánea por otro sistema puede introducir referencias fuera de esta comprobación. Los miembros, por diseño, pueden eliminar todas las fotos; las rutas del cliente no sustituyen las políticas de Storage.

Un cierre forzado de pestaña, pérdida de red prolongada o cambio de cuenta durante una subida puede impedir compensar. Se muestra advertencia de salida mientras hay una operación, pero los navegadores no garantizan ejecutar limpieza al cerrar. Tampoco puede garantizarse una compensación si se revoca la membresía en medio de ella.

## Reconciliar sin perder fotos

1. Espera a que no haya subidas activas y ejecuta la auditoría como propietario. Compara UUID/rutas del aviso con `album_photos` y con los objetos de Storage.
2. Si el registro existe y apunta al archivo, consérvalo; no elimines el original por una respuesta de red perdida.
3. Si no hay registro, comprueba que ninguna otra fila referencie la ruta. Repite la revisión más tarde antes de considerar un objeto huérfano. El timestamp de Storage ayuda a distinguir subidas en curso.
4. Descarga una copia si existe cualquier duda. Las eliminaciones manuales requieren tu decisión expresa. Borra objetos mediante Storage Dashboard/API; nunca borres directamente filas de `storage.objects` por SQL.
5. Para un registro de eliminación pendiente, usa de nuevo Eliminar en la app. Si los permisos impiden confirmar la ausencia del archivo, revisa las políticas antes de intervenir manualmente.

El SQL entregado solo enumera posibles huérfanos y registros con objetos ausentes. No incluye un limpiador automático ni DELETE de mantenimiento.

## Sesión, URLs y navegador

La sesión y los tokens los gestiona el SDK oficial en el almacenamiento del navegador (`nuestro-album-auth`), con renovación automática. La aplicación no guarda contraseñas. Un frontend estático no dispone de cookies HttpOnly gestionadas por un servidor propio; evita scripts de terceros y protege el dispositivo. El cierre usa `scope: local` para salir de este navegador sin cerrar el de la otra persona.

En Pages, varios repositorios de una misma cuenta comparten el origen `CUENTA.github.io`; sus subrutas no aíslan el almacenamiento del navegador. Publica en ese origen solo código de confianza o utiliza un dominio dedicado si alojas otras aplicaciones no confiables en la misma cuenta.

Las URLs firmadas son enlaces portadores: quien reciba uno podría usarlo hasta su vencimiento de **300 segundos**. Se cachean solo en memoria, se solicitan en lotes, se renuevan cuando restan 45 segundos o menos y se borran de memoria al cambiar de cuenta o cerrar sesión. Un timer de 30 segundos y los eventos de visibilidad, foco y reconexión restauran las imágenes. No se registran enlaces ni tokens en la consola. Revocar una membresía o cerrar sesión no invalida de inmediato URLs ya emitidas ni borra archivos que el navegador haya descargado.

Las imágenes originales conservan EXIF, incluida geolocalización si la tenían. Las miniaturas se dibujan en canvas. No se usa un service worker ni caché offline deliberada para las fotos, pero el navegador puede conservar recursos; cerrar sesión no es una herramienta de borrado remoto.

El HTML incorpora CSP por meta, con scripts/estilos locales y acceso de red limitado al origen configurado de Supabase; no hay analytics ni fuentes remotas. GitHub Pages no permite añadir todos los headers de seguridad; `frame-ancestors` requiere un header HTTP y no se simula mediante meta. Los nombres de archivo y mensajes externos se escriben con `textContent`, nunca como HTML. La comprobación de firma de bytes reduce archivos mal etiquetados, pero no reemplaza un antivirus; el bucket debe aplicar sus límites MIME y tamaño.

En desarrollo, la CSP también admite el WebSocket de Vite en `localhost`/`127.0.0.1` para recarga de módulos; esa excepción no se incluye en producción. Los estilos se cargan desde un archivo CSS externo y no se habilitan scripts o estilos inline.

No deben incorporarse secretos en `.env`, `VITE_*`, variables de Actions ni código publicado. `.gitignore` excluye credenciales locales; la compilación rechaza claves administrativas y `check:dist` busca patrones reconocibles y archivos privados. Esa búsqueda no garantiza detectar cualquier secreto arbitrario: revisa los archivos que vayas a subir al repositorio.
