import { readdir, readFile } from 'node:fs/promises';

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) { await scan(path); continue; }
    if (/^\.env(?:\.|$)|\.(?:pem|key|p12|map)$/i.test(entry.name)) throw new Error(`Archivo privado o mapa de código en publicación: ${path}`);
    if (!/\.(?:js|css|html|json|svg|txt)$/.test(entry.name)) continue;
    const text = await readFile(path, 'utf8');
    if (/sb_secret_[a-zA-Z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Posible secreto en ${path}`);
    for (const token of text.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) || []) {
      try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role') throw new Error(`JWT administrativo en ${path}`); }
      catch (error) { if (error.message.startsWith('JWT administrativo')) throw error; }
    }
  }
}
await scan('dist');
console.log('dist revisado: sin archivos .env, claves secretas reconocibles ni sourcemaps.');
