import { createClient } from '@supabase/supabase-js';
import { readConfig } from './environment.js';

export const config = readConfig(import.meta.env);
export const supabase = config.ready ? createClient(config.url, config.key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit', // Recuperación desde correo, incluso en otro navegador/dispositivo.
    storageKey: 'nuestro-album-auth',
  },
}) : null;
