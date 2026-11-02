import { AlbumError } from '../utils/errors.js';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MIME_EXTENSIONS = Object.freeze({ 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] });

export function validateFile(file) {
  const extension = file.name?.split('.').pop()?.toLowerCase();
  if (!MIME_EXTENSIONS[file.type]?.includes(extension)) throw new AlbumError('Solo se aceptan fotografías JPG, JPEG, PNG o WebP con el tipo correcto.');
  if (!file.size || file.size > MAX_BYTES) throw new AlbumError('Cada fotografía debe pesar entre 1 byte y 10 MB.');
}

export async function validateImageSignature(file) {
  validateFile(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!({ 'image/jpeg': jpeg, 'image/png': png, 'image/webp': webp })[file.type]) throw new AlbumError('El contenido del archivo no corresponde a su formato de imagen.');
}

export async function createThumbnail(file) {
  let source;
  let objectUrl;
  try {
    if ('createImageBitmap' in globalThis) source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    else {
      objectUrl = URL.createObjectURL(file);
      source = new Image();
      source.src = objectUrl;
      await source.decode();
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height || width * height > 60_000_000) return null;
    const scale = Math.min(1, 640 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.78));
    return blob?.type === 'image/webp' && blob.size <= MAX_BYTES ? blob : null;
  } catch { return null; }
  finally { source?.close?.(); if (objectUrl) URL.revokeObjectURL(objectUrl); }
}
