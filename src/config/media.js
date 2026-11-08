// Parámetros de optimización y límites de los recuerdos. Ajustables en un solo lugar.

// Miniatura de las tarjetas: lado mayor en píxeles. 480 px equivale a ~320 px de ancho
// en fotos verticales y mantiene nitidez en pantallas de alta densidad.
export const THUMBNAIL = Object.freeze({ maxSide: 480, quality: 0.8 });
// Versión de visualización para el lightbox y el MIX: lado mayor de hasta 1600 px.
export const DISPLAY = Object.freeze({ maxSide: 1600, quality: 0.8 });

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 15;
export const MAX_FILES_PER_UPLOAD = 10;
export const PLACE_MAX_LENGTH = 80;
