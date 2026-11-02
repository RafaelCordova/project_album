export class AlbumError extends Error {
  constructor(message, options = {}) { super(message, options); this.name = 'AlbumError'; this.details = options.details || null; }
}

export function friendlyError(error) {
  if (error instanceof AlbumError) return error.message;
  const message = String(error?.message || '');
  if (/invalid login credentials/i.test(message)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(message)) return 'Confirma tu correo antes de entrar.';
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(message)) return 'Se realizaron demasiados intentos. Espera unos minutos y vuelve a intentar.';
  if (/same_password/i.test(message) || /different from.*old/i.test(message)) return 'Elige una contraseña diferente a la anterior.';
  if (/password.*(short|least)|weak_password/i.test(message)) return 'La contraseña no cumple la política de seguridad del proyecto.';
  if (/fetch|network|offline/i.test(message)) return 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  if (/row.level|permission|policy|not authorized|unauthorized|403|42501/i.test(message)) return 'Supabase no autorizó la operación. Revisa la membresía y las políticas RLS y Storage.';
  if (/jwt|session|refresh token/i.test(message)) return 'La sesión venció. Cierra sesión y vuelve a entrar.';
  return 'No se pudo completar la operación. Inténtalo de nuevo; si persiste, revisa la configuración de Supabase.';
}
