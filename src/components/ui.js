export function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const paths = {
  book: '<path d="M3 4h6a4 4 0 0 1 3 1.5A4 4 0 0 1 15 4h6v15h-6a4 4 0 0 0-3 1.5A4 4 0 0 0 9 19H3Z"/><path d="M12 6v14M6 8h3M6 12h3"/>',
  heart: '<path d="m20.8 4.6 0 0a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  logout: '<path d="M9 4H4v16h5m5-13 5 5-5 5m-7-5h12"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

export function icon(name) {
  const span = element('span', 'icon');
  span.setAttribute('aria-hidden', 'true');
  // Solo utiliza trazos estáticos de este módulo, nunca contenido de Supabase.
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.image}</svg>`;
  return span;
}

export function button(label, name, className = 'button') {
  const node = element('button', className);
  node.type = 'button';
  if (name) node.append(icon(name));
  node.append(element('span', '', label));
  return node;
}

export function notify(message, type = 'success') {
  const node = element('div', `notice ${type}`);
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.append(icon(type === 'success' ? 'check' : 'image'), element('span', '', message));
  const close = button('Cerrar aviso', 'close', 'icon-button');
  close.addEventListener('click', () => node.remove());
  node.append(close);
  document.querySelector('#notifications').append(node);
  if (type !== 'error') setTimeout(() => node.remove(), 7000);
}

export function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Fecha no disponible';
}

export function brand() {
  const node = element('div', 'brand');
  const mark = element('span', 'brand-mark');
  mark.append(icon('book'));
  const text = element('div');
  text.append(element('span', 'brand-name', 'Nuestro Álbum'), element('span', 'brand-subtitle', 'UN LUGAR PARA NOSOTROS'));
  node.append(mark, text);
  return node;
}
