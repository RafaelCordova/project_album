import { loadEnv } from 'vite';
import { readConfig } from '../src/config/environment.js';

const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))) };
try {
  if (!readConfig(env).ready) throw new Error('Falta la URL o la clave publicable real. Configura las variables del repositorio antes de publicar.');
  console.log('Configuración pública válida. Este chequeo no verifica conectividad ni RLS.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
