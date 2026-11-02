import { AlbumError } from '../utils/errors.js';

export function createAuthService(client) {
  return {
    async session() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    async member() {
      const { data: { user }, error } = await client.auth.getUser();
      if (error) throw error;
      if (!user) throw new AlbumError('Inicia sesión para abrir el álbum.');
      const result = await client.from('album_members').select('user_id').eq('user_id', user.id).limit(1).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new AlbumError('Esta cuenta no pertenece al álbum. El propietario debe revisar album_members.');
      return user;
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
    async recover(email) {
      const redirect = new URL(import.meta.env?.BASE_URL || '/', window.location.origin);
      redirect.searchParams.set('recovery', '1');
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect.href });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },
  };
}
