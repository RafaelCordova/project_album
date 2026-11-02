# Publicar en GitHub Pages

La configuración pública local ya pasa `npm run check:config` y confirmaste la conexión a Supabase. Conserva `.env.local`; no necesitas copiar otra vez `.env.example`. Aún no hay un repositorio Git inicializado en esta carpeta ni se ha publicado el sitio. La cuenta, el repositorio y la URL final de GitHub siguen pendientes.

Para un repositorio privado, tu cuenta necesita GitHub Pro, Team u otro plan compatible; GitHub Free solo permite Pages desde repositorios públicos. Mantener privado el repositorio no restringe el acceso al frontend publicado. [Disponibilidad de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## 1. Completar las pruebas antes de publicar

En dos navegadores o dispositivos distintos, entra con cada cuenta, sube una foto de prueba, ábrela desde la otra cuenta, elimina la foto de la otra persona y recarga para comprobar la sesión. Verifica también la recuperación de contraseña si vas a utilizarla.

Confirma el bucket privado, solo los dos miembros previstos, el registro público deshabilitado y la denegación de lectura/escritura directa sin membresía. La conexión correcta no comprueba estas políticas. Usa `supabase/audit.sql` y `docs/SEGURIDAD.md`; no ejecutes la propuesta de cambios sin revisarla y autorizarla.

Ejecuta desde PowerShell, en `project_album`:

```powershell
npm run check:config
npm run check
npm test
npm run test:e2e
npm run build
npm run check:dist
npm run test:build
```

Las pruebas E2E simulan Supabase; no suben ni eliminan tus fotos reales. Para abrir la compilación de producción ejecuta `npm run preview` y entra a `http://127.0.0.1:4173/`. Detén el servidor con `Ctrl+C` antes de seguir.

## 2. Preparar GitHub y las variables

1. Termina la configuración y las pruebas reales de Supabase, especialmente RLS. El workflow no puede certificar esas políticas.
2. Crea un repositorio privado vacío en GitHub. Usa la rama `main` o ajusta el workflow si eliges otra.
3. En Settings → Pages, elige **GitHub Actions** como fuente de publicación.
4. En Settings → Secrets and variables → Actions → **Variables**, crea `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Si usas clave heredada, deja la publicable vacía y crea `VITE_SUPABASE_ANON_KEY` con la clave `anon`. Son valores públicos que se incorporan al frontend. Nunca pongas claves administrativas o contraseñas.
5. Normalmente no configures `VITE_BASE_PATH`: el workflow obtiene el nombre real del repositorio y usa `/NOMBRE/`. Para un repositorio `CUENTA.github.io` o dominio personalizado, usa `/`; la variable opcional `VITE_BASE_PATH` permite sobrescribirlo. Conserva la barra inicial y final.
6. Si quieres revisar cada publicación, configura un revisor requerido para el environment `github-pages`, si tu plan lo admite. El workflow ya tiene ese environment y solo otorga permisos de publicación al job `deploy`.

Los valores concretos de **Variables** son:

| Nombre | Qué copiar |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://ycomlinemyhlwjaklxju.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | La clave publicable que ya usas localmente, sin comillas |
| `VITE_SUPABASE_ANON_KEY` | Solo si utilizas la alternativa heredada; en ese caso deja la publicable vacía |
| `VITE_BASE_PATH` | Normalmente no se crea: el workflow deduce la ruta del repositorio |

`.env.local` no se sube a GitHub y no existe en el runner: por eso hay que definir las variables del repositorio aunque la aplicación local ya conecte. No añadas las contraseñas de las cuentas ni una clave administrativa a Variables o Secrets.

## 3. Subir y publicar cuando lo decidas

Tras decidir publicar, puedes inicializar y subir el proyecto. Sustituye los marcadores antes de usar estos comandos; no son la URL real:

```powershell
git init -b main
git status --short --ignored
git add .
git check-ignore .env.local
git diff --cached --name-only
# Confirma que no haya .env.local, fotos privadas, claves ni node_modules.
git commit -m "Implementar Nuestro Álbum"
git remote add origin https://github.com/TU_CUENTA/TU_REPOSITORIO.git
git push -u origin main
```

La acción se ejecuta automáticamente al subir a `main`. Si solo quieres guardar el código sin publicar aún, deja Pages deshabilitado o deshabilita temporalmente el workflow antes del push. Los pull requests solo verifican y compilan; no publican. También puedes ejecutar el workflow manualmente desde Actions en `main`.

`git check-ignore .env.local` debe mostrar `.env.local`, y `git diff --cached --name-only` no debe mostrarlo. Si el archivo ya se añadió a Git por otro procedimiento, `.gitignore` por sí solo no lo deja de rastrear: detén la publicación y corrige el índice antes de continuar. No pegues el contenido de ese archivo en un issue ni en el chat.

## Qué hace la automatización

Instala con `npm ci` y lockfile, verifica sintaxis, pruebas unitarias y pruebas E2E con Chromium (incluida la matriz responsive), calcula la ruta base, exige configuración pública válida, compila, revisa `dist` y sube exclusivamente ese directorio. `deploy-pages` publica el artefacto con permisos `pages:write` e `id-token:write`. No se incluyen `.env`, SQL, pruebas, README, código fuente suelto ni `node_modules` en el artefacto. No hay backend desplegado. [Vite en Pages](https://vite.dev/guide/static-deploy), [artefacto de Pages](https://github.com/actions/upload-pages-artifact), [publicación de Pages](https://github.com/actions/deploy-pages).

El workflow no ejecuta SQL ni modifica Supabase. Los tests E2E usan Chrome instalado en Windows o Chromium de Playwright en Linux/CI.

## 4. Configurar la URL final en Supabase Auth

Cuando GitHub muestre la URL real en Settings → Pages o en el job `deploy`, cópiala. El patrón habitual de un sitio de proyecto es `https://CUENTA.github.io/REPOSITORIO/`, pero no se ha asignado una cuenta ni un repositorio en esta entrega.

En Supabase → Authentication → URL Configuration:

- **Site URL:** la URL real del sitio con subruta y barra al final.
- **Redirect URLs:** añade la misma URL con `?recovery=1`, por ejemplo el patrón `https://CUENTA.github.io/REPOSITORIO/?recovery=1` tras reemplazar los marcadores.
- Conserva las redirecciones locales exactas mientras las necesites. Evita comodines amplios en producción.

El sitio solo usa la entrada `index.html` y parámetros de consulta; no requiere un router con fallback ni un archivo `404.html`. El enlace de recuperación vuelve a esa misma entrada.

## Comprobar una subruta antes de publicar

```powershell
$env:VITE_BASE_PATH = '/NOMBRE_REAL_DEL_REPOSITORIO/'
npm run build
npm run check:dist
npm run preview
```

Abre `http://127.0.0.1:4173/NOMBRE_REAL_DEL_REPOSITORIO/`. Detén el servidor y elimina la sobrescritura de esta terminal al terminar:

```powershell
Remove-Item Env:VITE_BASE_PATH
```

Si usas recuperación en esa previsualización, añade su URL exacta con `?recovery=1` en Supabase. `dist/` se regenera en cada compilación y no debe contener fotos del usuario ni archivos de configuración locales.

Después de publicar, repite login, recarga, subida, ampliación, eliminación por la otra cuenta, recuperación y salida en móvil. Verifica que una ventana privada sin sesión no pueda consultar APIs ni descargar el bucket directamente.

## Resolver errores habituales

| Síntoma | Qué revisar |
| --- | --- |
| GitHub no ofrece Pages para el repositorio privado | Plan de GitHub compatible; no es necesario hacer públicas tus fotos ni tu bucket |
| Actions falla en `check:config` | Variables de Actions configuradas en el repositorio, no solo en `.env.local` |
| Pantalla sin estilos o recursos con 404 | `VITE_BASE_PATH` y URL de entrada con la subruta y barra final |
| Login funciona pero las fotos no cargan | `album_members`, RLS y políticas SELECT de Storage; el bucket debe seguir privado |
| La otra persona no puede borrar una foto | SELECT y DELETE deben admitir a ambos miembros, sin limitarse al autor |
| Recuperación vuelve a otra página | Site URL y Redirect URLs exactas, incluida la subruta y `?recovery=1` |
| No llega el correo de recuperación | Configuración SMTP, destinatarios permitidos y límites del servicio |
