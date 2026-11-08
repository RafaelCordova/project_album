import { brand, button, element, icon } from './ui.js';
import { attachPasswordToggle } from './passwordToggle.js';

export function authView(mode = 'login') {
  const page = element('main', 'auth-page');
  page.id = 'main';
  const story = element('section', 'auth-story');
  story.append(brand());
  const storyContent = element('div', 'story-content');
  storyContent.innerHTML = '<p class="eyebrow">LOS DÍAS PASAN. LOS RECUERDOS SE QUEDAN.</p><h1>Lo mejor de la vida,<br /><em>contigo.</em></h1><p class="story-description">Los paseos, las risas y esos pequeños momentos<br class="desktop-break" /> que hacen nuestra historia.</p><div class="paper-memories" aria-hidden="true"><div class="paper-photo photo-back"><div class="landscape landscape-blue"><span class="sun"></span></div><span>un lugar, tú y yo</span></div><div class="paper-photo photo-front"><div class="landscape landscape-sand"><span class="sun"></span></div><span>nuestros días favoritos ♡</span></div><span class="paper-heart">♡</span></div>';
  story.append(storyContent, element('p', 'story-footer', 'Hecho de momentos. Guardado con amor.'));
  const panel = element('section', 'auth-panel');
  const formWrap = element('div', 'auth-form-wrap');
  const emblem = element('div', 'auth-emblem');
  emblem.append(icon(mode === 'login' ? 'lock' : 'heart'));
  const titles = { login: ['Formulario de ingreso.', 'Entra a nuestro pequeño rincón de recuerdos.'], recover: ['Volvamos a encontrarnos.', 'Te enviaremos un enlace para cambiar tu contraseña.'], password: ['Un nuevo comienzo.', 'Elige una contraseña para proteger tus recuerdos.'] };
  const [title, subtitle] = titles[mode];
  formWrap.append(emblem, element('p', 'eyebrow', 'SOLO PARA NOSOTROS'), element('h2', '', title), element('p', 'muted auth-description', subtitle));
  const form = element('form', 'auth-form');
  if (mode === 'password') {
    form.innerHTML = '<label for="password">Nueva contraseña</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Al menos 12 caracteres" /><label for="confirm-password">Repite la contraseña</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required placeholder="Escríbela otra vez" />';
  } else {
    form.innerHTML = '<label for="email">Tu correo electrónico</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required placeholder="tu@correo.com" />';
    if (mode === 'login') form.insertAdjacentHTML('beforeend', '<label for="password">Tu contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="128" required placeholder="Tu contraseña" />');
  }
  form.querySelectorAll('input[type="password"]').forEach((input) => attachPasswordToggle(input));
  // Contenedor del widget CAPTCHA (solo se usa si hay una sitekey configurada).
  const captcha = element('div', 'captcha-box');
  captcha.hidden = true;
  const captchaRetry = button('Reintentar verificación', 'refresh', 'text-button captcha-retry');
  captchaRetry.hidden = true;
  const status = element('p', 'form-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const submit = button(mode === 'login' ? 'Ingresar' : mode === 'recover' ? 'Enviar enlace de recuperación' : 'Guardar contraseña', 'arrow', 'button primary full');
  submit.type = 'submit';
  if (mode === 'login') submit.classList.add('login-submit');
  if (mode !== 'password') form.append(captcha, captchaRetry);
  form.append(status, submit);
  const alternate = button(mode === 'login' ? '¿Olvidaste tu contraseña?' : mode === 'password' ? 'Cerrar sesión' : 'Volver al inicio de sesión', null, 'text-button auth-alternate');
  const privacy = element('p', 'privacy-note');
  privacy.append(icon('lock'), element('span', '', 'Nuestros recuerdos, en un espacio privado y compartido.'));
  formWrap.append(form, alternate, privacy);
  panel.append(formWrap, element('p', 'auth-bottom', 'Una historia que seguimos escribiendo juntos.'));
  page.append(story, panel);
  return { page, form, submit, status, alternate, captcha, captchaRetry };
}
