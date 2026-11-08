import { readdir, readFile } from 'node:fs/promises';

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) { await scan(path); continue; }
    if (/^\.env(?:\.|$)|\.(?:pem|key|p12|map)$/i.test(entry.name)) throw new Error(`Archivo privado o mapa de código en publicación: ${path}`);
    if (!/\.(?:js|css|html|json|svg|txt)$/.test(entry.name)) continue;
    const text = await readFile(path, 'utf8');
    if (/sb_secret_[a-zA-Z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Posible secreto en ${path}`);
    // Las claves secretas de Turnstile (~35 caracteres) son más largas que las sitekeys públicas (~24).
    for (const candidate of text.match(/\b[0-3]x[0-9A-Za-z_-]{31,40}\b/g) || []) {
      if (/^0x4AAAAAAA|^[0-3]x0{20,}/.test(candidate)) throw new Error(`Posible clave secreta de Turnstile en ${path}`);
    }
    for (const token of text.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) || []) {
      try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role') throw new Error(`JWT administrativo en ${path}`); }
      catch (error) { if (error.message.startsWith('JWT administrativo')) throw error; }
    }
  }
}
await scan('dist');
console.log('dist revisado: sin archivos .env, claves secretas reconocibles ni sourcemaps.');
