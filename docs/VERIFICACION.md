# Verificación ejecutada

Fecha: **27 de octubre de 2026** (America/Lima). Entorno: Windows/PowerShell, Node.js **24.11.0**, npm **11.6.1**, Chrome local para Playwright.

| Comprobación | Resultado ejecutado |
| --- | --- |
| `npm install --no-fund --no-audit` | Dependencias instaladas; lockfile generado |
| `npm run check` | Sintaxis correcta en 26 archivos JavaScript |
| `npm test` | **21 pruebas unitarias aprobadas** |
| `npm run test:e2e` | **26 pruebas de navegador aprobadas** en Chrome local, con Supabase simulado; última suite completa: 40,2 s |
| Matriz responsive | 16 tamaños entre 320 × 568 y 1920 × 1080; tres temas, fotos verticales/panorámicas y nombres largos |
| Casos adicionales | Estado vacío, cola de errores, mensajes largos, acceso denegado y emulación táctil con rotación |
| `npm run build` | Compilación de producción correcta; salida `dist/` |
| `npm run check:dist` | Sin archivos `.env`, claves secretas reconocibles ni sourcemaps en `dist/` |
| `npm run test:build` con base `/` | Entrada, JS, CSS, favicon, estilos y consola correctos en Chrome |
| Build y `test:build` con base `/prueba-album/` | Mismos recursos correctos bajo una subruta de repositorio |
| `npm audit --omit=dev` | 0 vulnerabilidades reportadas |
| `npm audit --audit-level=low` | 0 vulnerabilidades reportadas incluyendo dependencias de desarrollo |
| Revisión de variables y archivos | Existe `.env.local` configurado por el propietario; está excluido por `.gitignore` y no se copia a `dist/` |
| Búsqueda de fixtures en `dist/` | Sin `TEST_ONLY` ni `example.invalid` en el artefacto final |
| `npm run check:config` | Configuración pública local válida, sin mostrar el valor de la clave |

Se revisaron visualmente capturas del login, álbum móvil de 320 px, álbum de tableta de 820 px y lightbox en horizontal de 568 × 320. Se corrigieron controles menores de 44 px, el acceso al cambio de contraseña en móvil, el espacio de los diálogos en horizontal y los nombres largos. Las pruebas comprueban el ancho, el ajuste y la proporción de las imágenes y que la navegación no cubra el pie del lightbox.

Las pruebas de diseño usan capturas explícitas y desactivan trazas para evitar el coste de retener las numerosas instantáneas de la matriz. La suite completa termina correctamente y el runner cierra el servidor Vite. Las pruebas funcionales conservan trazas en caso de fallo. No se añadieron dependencias para esta revisión.

La última compilación queda con base `/` y la configuración pública local; muestra el formulario de acceso. El propietario confirmó la conexión a Supabase. El agente verificó el arranque sin iniciar sesión y con las peticiones HTTPS externas bloqueadas para el smoke test. El workflow calcula la base real del repositorio y ahora también ejecuta las pruebas E2E de diseño antes de publicar. No se incluyeron fotos privadas, contraseñas ni claves administrativas.

## Qué no está probado todavía

- Login y recuperación con las dos cuentas reales, entrega SMTP y redirecciones reales.
- Safari/iOS y Chrome/Android en dispositivos físicos, teclado móvil real, recortes de pantalla y zoom del navegador al 200 %. La emulación táctil no certifica esos entornos.
- Lectura, subida, URLs firmadas y eliminación contra el Storage/PostgreSQL reales.
- RLS, grants, funciones, vistas, constraints y contenido remoto de `album_members`: solo se recibió su descripción, no sus definiciones completas.
- La propuesta SQL en un motor PostgreSQL: se entrega para revisión y no se ejecutó local ni remotamente.
- Publicación con GitHub Actions, plan de GitHub y URL final: no se creó ni se publicó un repositorio remoto.

La API simulada permite verificar el código y los flujos, pero no demuestra el aislamiento del proyecto real. Completa `SEGURIDAD.md`, la matriz real de `PRUEBAS.md` y los pasos de `DESPLIEGUE.md` antes de publicar. No se aplicó SQL remoto ni se publicó el sitio.

## Verificación de las mejoras v2 (7 de noviembre de 2026)

Ejecutado en Windows 11 con Node 26 y Chrome instalado. Todo contra Supabase y Cloudflare simulados; no se tocó el proyecto real.

| Comando | Resultado |
| --- | --- |
| `npm run check` | 44 archivos sin errores de sintaxis |
| `npm test` | 68 pruebas unitarias en verde (21 anteriores + 47 nuevas) |
| `npm run test:e2e` | 46 pruebas en verde (26 anteriores + 20 nuevas); también 138/138 repitiendo la suite tres veces |
| `npm run build` con `VITE_BASE_PATH=/project_album/` | Compilación correcta; CSP con `media-src` y sin Turnstile al no haber sitekey |
| `npm run check:dist` | Sin `.env`, sourcemaps ni claves secretas (Supabase o Turnstile) |
| `npm run test:build` | Producción servida en `/project_album/` sin errores |
| `npm audit` | 0 vulnerabilidades; no se añadieron dependencias |

Los SQL v2 se reescribieron tras conocer el estado real de Supabase (ver [Auditoría SQL v2](SQL_V2_AUDIT.md)). En PostgreSQL 18 local (PGlite), sobre una réplica de ese estado: PASO 1 y PASO 2 aplicados dos veces sin errores, `verify-v2.sql` con 51 comprobaciones en `ok = true`, 76 comprobaciones de comportamiento correctas (permisos por columna, rutas, Storage sin UPDATE, borrado compartido, rutas heredadas) y las precondiciones detienen la ejecución sin aplicar nada.

**Aplicación en Supabase real (8 de noviembre de 2026, por el propietario):** se ejecutaron el PASO 1 (`supabase/migrations/20261106_recuerdos_v2.sql`) y el PASO 2 (`supabase/proposed-policies.sql`). `supabase/verify-v2.sql` dio 51/51 `ok = true` y se conservaron los 3 recuerdos existentes. El propietario también informó que las pruebas con las dos cuentas en la app local pasaron (11 de 11).

Pendiente (manual, del propietario): `npm run check:remote` contra el proyecto real y, si se desea, configurar Turnstile siguiendo [Mejoras v2](MEJORAS.md#3-captcha-con-cloudflare-turnstile).
