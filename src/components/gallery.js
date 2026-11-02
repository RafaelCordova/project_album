import { button, element, formatDate, icon } from './ui.js';

export function renderGallery(container, photos, urls, { loading, onOpen, onDelete, onImageError }) {
  container.replaceChildren();
  container.setAttribute('aria-busy', String(loading));
  if (!photos.length) {
    const empty = element('div', 'empty-state');
    empty.append(icon(loading ? 'refresh' : 'image'), element('h3', '', loading ? 'Buscando nuestros recuerdos…' : 'Toda historia empieza con un momento.'), element('p', 'muted', loading ? 'Un instante, ya casi estamos.' : 'Sube nuestra primera foto y guardémosla aquí, juntos.'));
    container.append(empty);
    return;
  }
  const grid = element('div', 'photo-grid');
  for (const [index, photo] of photos.entries()) {
    const card = element('article', 'photo-card');
    const open = button(`Ampliar ${photo.original_name}`, null, 'photo-open');
    open.replaceChildren();
    open.setAttribute('aria-label', `Ampliar ${photo.original_name}`);
    const placeholder = element('span', 'photo-placeholder');
    placeholder.append(icon('image'), element('span', '', 'Vista previa no disponible'));
    const image = element('img');
    image.alt = photo.original_name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.dataset.photoId = photo.id;
    const url = urls.get(photo.thumbnail_path || photo.storage_path);
    image.hidden = !url;
    if (url) image.src = url;
    image.addEventListener('load', () => { image.hidden = false; placeholder.hidden = true; });
    image.addEventListener('error', () => onImageError(photo, image, placeholder));
    open.append(placeholder, image);
    const zoom = element('span', 'zoom-label', 'Ver recuerdo');
    zoom.append(icon('plus'));
    open.append(zoom);
    open.addEventListener('click', () => onOpen(index));
    const info = element('div', 'photo-info');
    const description = element('div', 'photo-description');
    const name = element('h3', '', photo.original_name);
    name.title = photo.original_name;
    const date = element('time', '', formatDate(photo.created_at));
    if (photo.created_at) date.dateTime = photo.created_at;
    description.append(name, date);
    const remove = button('Eliminar fotografía', 'trash', 'icon-button delete-photo');
    remove.setAttribute('aria-label', `Eliminar ${photo.original_name}`);
    remove.title = 'Eliminar fotografía';
    remove.addEventListener('click', () => onDelete(photo));
    info.append(description, remove);
    card.append(open, info);
    grid.append(card);
  }
  container.append(grid);
}
