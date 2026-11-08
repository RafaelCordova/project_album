import { element, icon } from './ui.js';

// Cambia la visibilidad sin tocar el valor escrito. Solo usa atributos, por lo que se prueba sin DOM real.
export function setPasswordVisibility(input, toggle, visible) {
  input.type = visible ? 'text' : 'password';
  toggle.dataset.visible = String(visible);
  toggle.setAttribute('aria-pressed', String(visible));
  const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

export function togglePasswordVisibility(input, toggle) {
  setPasswordVisibility(input, toggle, input.type === 'password');
}

// Envuelve un input de contraseña existente con el botón del ojo.
export function attachPasswordToggle(input) {
  const wrapper = element('div', 'password-field');
  const form = input.form;
  input.replaceWith(wrapper);
  const toggle = element('button', 'password-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', input.id);
  const shown = icon('eyeOff');
  shown.classList.add('when-visible');
  const hidden = icon('eye');
  hidden.classList.add('when-hidden');
  toggle.append(hidden, shown);
  setPasswordVisibility(input, toggle, false);
  // Evita que el campo pierda el foco al pulsar con ratón o dedo; el teclado sigue usando Tab + Enter/Espacio.
  toggle.addEventListener('pointerdown', (event) => { if (document.activeElement === input) event.preventDefault(); });
  toggle.addEventListener('click', () => {
    const { selectionStart, selectionEnd } = input;
    const hadFocus = document.activeElement === input;
    togglePasswordVisibility(input, toggle);
    if (hadFocus) { input.focus(); try { input.setSelectionRange(selectionStart, selectionEnd); } catch { /* Algunos tipos no admiten selección. */ } }
  });
  // Al enviar o salir del formulario se vuelve a ocultar.
  form?.addEventListener('submit', () => setPasswordVisibility(input, toggle, false));
  wrapper.append(input, toggle);
  return toggle;
}
