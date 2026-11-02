# Verificar el diseño responsive

El diseño usa una cuadrícula que adapta sus columnas al espacio disponible, paneles que se apilan en tabletas y móviles, controles de al menos 44 × 44 px y campos de contraseña/correo de 16 px. El cambio de contraseña está disponible también en móvil. No se ocultan funcionalidades para hacer caber la página.

El lightbox distribuye la imagen, la navegación y el pie en una cuadrícula: la imagen conserva su proporción y las flechas no cubren nombre ni fecha. Los nombres largos se pueden desplazar dentro del pie. Los diálogos de confirmación tienen desplazamiento vertical para pantallas de poca altura. Se respetan los márgenes de seguridad de dispositivos con recortes mediante `safe-area-inset-*` y `viewport-fit=cover`.

## Pruebas automáticas

```powershell
npm run test:e2e
```

También puedes ejecutar solo las pruebas de diseño:

```powershell
npm run test:e2e -- --grep 'pantallas y controles|mensajes, cola|denegación de acceso|uso táctil'
```

La matriz cubre estos tamaños en píxeles CSS:

| Tipo | Tamaños |
| --- | --- |
| Móvil vertical | 320 × 568, 360 × 640, 375 × 812, 390 × 844, 414 × 896 |
| Móvil horizontal | 568 × 320, 667 × 375 |
| Tableta y cambios de distribución | 600 × 960, 760 × 600, 761 × 600, 768 × 1024, 820 × 1180, 1024 × 768 |
| Escritorio | 1280 × 720, 1440 × 900, 1920 × 1080 |

En cada tamaño se comprueban inicio de sesión, recuperación, galería con seis fotos y nombres largos, los tres temas, imagen ampliada, confirmación y cambio de contraseña. Se comprueba que no haya desplazamiento horizontal, que los controles estén dentro de la pantalla, que las fotos verticales/panorámicas se vean sin recorte ni deformación y que los botones puedan usarse. Las comprobaciones adicionales cubren estado vacío, mensajes largos, cola de errores, acceso denegado y emulación táctil con rotación.

Los datos y las imágenes son simulados; ninguna prueba accede a tus fotografías reales. Las capturas de tamaños representativos se guardan dentro de `test-results/` y no se publican.

Para comprobar con Edge instalado en Windows:

```powershell
$env:PLAYWRIGHT_BROWSER_CHANNEL = 'msedge'
npm run test:e2e -- --grep 'pantallas y controles|uso táctil'
Remove-Item Env:PLAYWRIGHT_BROWSER_CHANNEL
```

En GitHub Actions se instala Chromium y se ejecuta la suite E2E antes de publicar. El resultado local y sus límites se documentan en `VERIFICACION.md`.

## Comprobación final en dispositivos reales

La emulación no sustituye al navegador y al teclado de un teléfono real. Antes de publicar, abre la versión de producción y comprueba:

1. Safari de iPhone y Chrome de Android: login, teclado abierto, campos visibles y posibilidad de desplazarte hasta el botón de envío.
2. Galería, selección de archivos y lightbox: girar el teléfono con una foto abierta, cerrar, avanzar y cancelar una eliminación.
3. Desplazamiento de un nombre largo y botones del diálogo con la pantalla en horizontal; los márgenes de recortes y barra inferior no deben taparlos.
4. Escritorio: zoom del navegador al 200 % y navegación con Tab, Shift+Tab, Enter y Escape.

El soporte validado comienza en 320 px CSS de ancho y 320 px de altura para el lightbox. No se garantiza comportamiento idéntico en todos los navegadores o configuraciones de accesibilidad sin probarlos; cualquier diferencia reproducible debe revisarse antes de dar por cerrado ese dispositivo.
