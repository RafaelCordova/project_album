# Nuestro Álbum

Álbum compartido para las dos cuentas existentes de Supabase. Frontend estático con HTML, CSS, JavaScript ES modules y Vite; Auth, PostgreSQL y Storage privado en Supabase. Sin servidor propio ni registro público en la interfaz.

**Estado:** implementado y compilable. La configuración pública local pasa la validación y el propietario confirmó la conexión a Supabase. Antes de publicar, verifica las políticas remotas y completa las pruebas con ambas cuentas. No se aplicó SQL remoto ni se publicó el sitio. Conserva tu `.env.local`; no lo reemplaces con el ejemplo si ya funciona.

## Ejecutar en PowerShell

Requisito: Node.js 22.12 o posterior; recomendado Node.js 24 LTS. En esta entrega las dependencias ya están instaladas y `package-lock.json` fija las versiones.

```powershell
Set-Location 'C:\Users\rafae\Desktop\PROYECTOS_GyA\project_album'
npm ci
Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
notepad .env.local
```

Ejecuta `Copy-Item` solo la primera vez para conservar tu configuración. Introduce la clave **publicable real** del panel de Supabase en el marcador y guarda el archivo. Nunca uses una clave secreta, administrativa ni contraseñas aquí.

```powershell
npm run dev
```

Abre `http://127.0.0.1:5173/`. Reinicia Vite después de cambiar `.env.local`. Detén el servidor con `Ctrl+C`. No abras `index.html` mediante `file://`.

Para revisar la versión de producción:

```powershell
npm run check:config
npm run check
npm test
npm run build
npm run check:dist
npm run preview
```

Abre `http://127.0.0.1:4173/`. `check:config` exige tu configuración real, pero no comprueba conectividad ni RLS. `build` también funciona sin clave y genera la pantalla de preparación, útil para revisar el proyecto; el workflow impide publicar sin configuración.

## Datos que debes completar

| Dato | Dónde | Valor |
| --- | --- | --- |
| URL | `.env.local`: `VITE_SUPABASE_URL` | `https://ycomlinemyhlwjaklxju.supabase.co` |
| Clave publicable | `.env.local`: `VITE_SUPABASE_PUBLISHABLE_KEY` | Configurada localmente; copiar también a Variables de GitHub Actions al desplegar |
| Alternativa heredada | `VITE_SUPABASE_ANON_KEY` | Solo clave JWT con rol `anon`; deja vacía la publicable si usas esta opción |
| UUID y tema de cada cuenta | `src/config/userThemes.js` | UUID real del propietario → `blue`; UUID real de la enamorada → `rose` |
| Miembros | `public.album_members` | Confirmar que solo estén los dos UUID previstos |
| URL final | Supabase Auth y GitHub Pages | Pendiente de conocer cuenta y repositorio |

La clave publicable y la alternativa `anon` quedan visibles en el JavaScript publicado. Su uso en navegador depende de RLS; esconderlas no protege las fotos. La compilación rechaza claves `sb_secret_`, JWT con roles diferentes de `anon` y variables `VITE_*` no previstas. [Claves de Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

Los UUID de temas solo cambian la apariencia. Las cuentas sin asociación usan el tema neutral. Nunca se inventaron las identidades de las dos personas.

## Funcionalidades

- Login por correo y contraseña, recuperación de sesión, cierre de sesión local y cambio/recuperación de contraseña.
- Comprobación de membresía antes de abrir la galería, además de las comprobaciones obligatorias en Supabase.
- Galería paginada de 48 fotos, carga diferida, metadatos y vista ampliada con Escape y flechas.
- Subida secuencial de hasta 10 fotos por selección, arrastrar y soltar, validación de extensión, MIME, firma de bytes y límite de 10 MiB por archivo.
- Original sin modificar y miniatura WebP de hasta 640 px por lado, sin ampliar imágenes pequeñas.
- URLs privadas firmadas en lotes de hasta 100 rutas, válidas 5 minutos y renovadas antes de vencer.
- Eliminación de cualquier recuerdo por cualquiera de los miembros, confirmación y tratamiento de fallos parciales.
- Temas azul, rosa y neutral, navegación por teclado, diálogos modales y diseño móvil.

Las fechas corresponden a la subida y se muestran en la zona horaria del dispositivo. No se presupone que exista fecha de captura, descripción, tamaño, ancho ni otra columna adicional.

### Mejoras v2

- Botón de ojo para mostrar u ocultar la contraseña (accesible con teclado y táctil).
- CAPTCHA Cloudflare Turnstile en el login y la recuperación, validado por Supabase Auth en su servidor. **Desactivado** hasta configurar `VITE_TURNSTILE_SITE_KEY` y activarlo en el panel.
- Videos MP4 (H.264/AAC) de hasta 15 s y 5 MB, con vista previa, cancelación, progreso, portada y reproducción bajo demanda.
- Fotos optimizadas: miniatura WebP de 480 px para la galería y versión WebP de 1600 px para el lightbox y el MIX; el original se conserva intacto.
- Fecha del recuerdo y lugar editables, galería agrupada por mes y filtros por año, mes, lugar y tipo.
- **MIX DE RECUERDOS**: presentación cronológica con separadores por mes, pausa, velocidad y controles.

Los videos, la edición de fecha/lugar y la versión optimizada requieren la migración `supabase/migrations/20261106_recuerdos_v2.sql` (PASO 1) y `supabase/proposed-policies.sql` (PASO 2). **Ambos se aplicaron en Supabase el 8 de noviembre de 2026**: `supabase/verify-v2.sql` dio 51/51 `ok = true` y se conservaron los 3 recuerdos existentes. Sin la migración, la app seguiría funcionando en modo clásico. Pasos, verificación y limitaciones: [Mejoras v2](docs/MEJORAS.md).

## Estructura creada

```text
index.html                         Entrada y CSP
public/favicon.svg                 Icono local
src/main.js                        Estado, sesión y coordinación de la interfaz
src/config/                        Entorno, cliente Supabase y temas por UUID
src/services/                      Auth, imágenes, Storage y metadatos
src/components/                    Formularios, galería y utilidades de presentación
src/styles/                        Diseño responsive y variables de los tres temas
src/utils/errors.js                Mensajes de error
scripts/                           Sintaxis, configuración, dist y runner E2E
tests/unit/                        Pruebas de servicios y fallos parciales
tests/e2e/                         Recorridos del navegador con API simulada
supabase/audit.sql                 Auditoría manual de solo lectura
supabase/migrations/               PASO 1 v2: esquema y bucket, aplicado el 8/11/2026
supabase/proposed-policies.sql     PASO 2 v2: permisos y RLS, aplicado el 8/11/2026
supabase/verify-v2.sql             Verificación v2 de solo lectura
docs/                              Configuración, seguridad, despliegue y pruebas
.github/workflows/pages.yml        CI y publicación de dist
.env.example, .gitignore, .npmrc    Configuración local sin secretos
package.json, package-lock.json    Dependencias y comandos
vite.config.js                     Ruta base, compilación y CSP
playwright.config.js               Configuración de pruebas del navegador
```

Dependencias de producción: `@supabase/supabase-js` **2.118.0**. Desarrollo: Vite **8.3.5** y Playwright Test **1.64.1**. npm utiliza una caché local ignorada (`.npm-cache`) para funcionar dentro de esta carpeta.

## Configuración y publicación pendientes

1. Sigue [Configuración de Supabase](docs/SUPABASE.md): clave, miembros, desactivar altas públicas y URLs de recuperación. Para las mejoras v2 (migración, bucket y CAPTCHA), sigue [Mejoras v2](docs/MEJORAS.md).
2. Ejecuta manualmente la auditoría de solo lectura y revisa [Seguridad](docs/SEGURIDAD.md). Las definiciones reales de las políticas no se proporcionaron: no se han dado por seguras ni se han modificado.
3. Completa las [pruebas con ambas cuentas](docs/PRUEBAS.md), incluida la denegación de acceso anónimo directo a la API.
4. Prepara el repositorio y sigue [GitHub Pages](docs/DESPLIEGUE.md). El workflow calcula la subruta del repositorio y publica únicamente `dist/` al subir cambios a `main`.

El diseño responsive tiene una matriz de 16 tamaños y pruebas de móvil táctil, fotos verticales/panorámicas, diálogos y nombres largos. Consulta [Responsive](docs/RESPONSIVE.md) para reproducirlas y [Verificación](docs/VERIFICACION.md) para conocer el resultado ejecutado y las pruebas manuales pendientes.

**GitHub Pages desde un repositorio privado requiere GitHub Pro, Team u otro plan compatible.** GitHub Free permite Pages desde repositorios públicos. El sitio publicado será accesible por Internet; las fotos seguirán dependiendo de Auth, RLS y el bucket privado. [Planes y disponibilidad](https://docs.github.com/en/pages/getting-started-with-github-pages).

## Límites relevantes

Las pruebas automáticas usan una API simulada y no certifican tus políticas remotas. Las miniaturas dependen del navegador; si no puede generarlas se usa el original en la galería. No hay transacción atómica entre Storage y PostgreSQL: se implementan compensación y reintentos, con reconciliación manual para casos ambiguos. Las URLs firmadas ya emitidas pueden seguir funcionando hasta su vencimiento después de cerrar sesión. No hay sincronización Realtime: pulsa **Actualizar** para ver cambios de la otra persona. El correo de recuperación depende del SMTP y las redirecciones configuradas en Supabase.
