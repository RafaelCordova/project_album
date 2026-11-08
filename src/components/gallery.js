import { button, element, icon } from './ui.js';
import { formatMemoryDate, groupByMonth, mediaType, normalizePlace } from '../services/memories.js';

// URL de la tarjeta: miniatura optimizada. Para fotos antiguas sin miniatura, el original (respaldo).
// Un video NUNCA usa su archivo como imagen: sin portada se muestra un marcador.
export function cardPath(photo) {
  if (mediaType(photo) === 'video') return photo.thumbnail_path || null;
  return photo.thumbnail_path || photo.storage_path;
}

function card(photo, index, urls, { onOpen, onDelete, onEdit, onImageError, editable }) {
  const video = mediaType(photo) === 'video';
  const article = element('article', `photo-card${video ? ' is-video' : ''}`);
  const open = element('button', 'photo-open');
  open.type = 'button';
  open.setAttribute('aria-label', `${video ? 'Reproducir' : 'Ampliar'} ${photo.original_name}`);
  const placeholder = element('span', 'photo-placeholder');
  placeholder.append(icon(video ? 'video' : 'image'), element('span', '', video ? 'Video sin portada' : 'Vista previa no disponible'));
  const image = element('img');
  image.alt = photo.original_name;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.width = 480;
  image.height = 360;
  image.dataset.photoId = photo.id;
  const url = urls.get(cardPath(photo));
  image.hidden = !url;
  if (url) image.src = url;
  image.addEventListener('load', () => { image.hidden = false; placeholder.hidden = true; });
  image.addEventListener('error', () => onImageError(photo, image, placeholder));
  open.append(placeholder, image);
  if (video) {
    const badge = element('span', 'video-badge');
    badge.append(icon('play'), element('span', '', photo.duration_seconds ? `${Math.round(photo.duration_seconds)} s` : 'Video'));
    open.append(badge);
  }
  const zoom = element('span', 'zoom-label', video ? 'Ver video' : 'Ver recuerdo');
  zoom.append(icon(video ? 'play' : 'plus'));
  open.append(zoom);
  open.addEventListener('click', () => onOpen(index));
  const info = element('div', 'photo-info');
  const description = element('div', 'photo-description');
  const name = element('h3', '', photo.original_name);
  name.title = photo.original_name;
  const date = element('time', photo.memory_date ? '' : 'is-upload-date', formatMemoryDate(photo));
  date.dateTime = photo.memory_date || photo.created_at || '';
  description.append(name, date);
  const place = normalizePlace(photo.place);
  if (place) {
    const placeLine = element('span', 'photo-place');
    placeLine.append(icon('pin'), element('span', '', place));
    placeLine.title = place;
    description.append(placeLine);
  }
  const actions = element('div', 'photo-actions');
  if (editable) {
    const edit = button('Editar fecha y lugar', 'pencil', 'icon-button edit-photo');
    edit.setAttribute('aria-label', `Editar fecha y lugar de ${photo.original_name}`);
    edit.title = 'Editar fecha y lugar';
    edit.addEventListener('click', () => onEdit(photo));
    actions.append(edit);
  }
  const remove = button(video ? 'Eliminar video' : 'Eliminar fotografía', 'trash', 'icon-button delete-photo');
  remove.setAttribute('aria-label', `Eliminar ${photo.original_name}`);
  remove.title = video ? 'Eliminar video' : 'Eliminar fotografía';
  remove.addEventListener('click', () => onDelete(photo));
  actions.append(remove);
  info.append(description, actions);
  article.append(open, info);
  return article;
}

/**
 * Dibuja los recuerdos visibles agrupados por mes.
 * `photos` ya llega filtrado y ordenado; `index` en onOpen es su posición en esa lista.
 */
export function renderGallery(container, photos, urls, { loading, filtered = false, editable = false, onOpen, onDelete, onEdit = () => {}, onImageError, onClearFilters = () => {} }) {
  container.replaceChildren();
  container.setAttribute('aria-busy', String(loading));
  if (!photos.length) {
    const empty = element('div', 'empty-state');
    if (filtered && !loading) {
      empty.append(icon('calendar'), element('h3', '', 'No hay recuerdos con estos filtros.'), element('p', 'muted', 'Prueba con otro mes, otro lugar o muestra todos los recuerdos.'));
      const all = button('Ver todos los recuerdos', 'refresh', 'button secondary compact');
      all.addEventListener('click', onClearFilters);
      empty.append(all);
    } else {
      empty.append(icon(loading ? 'refresh' : 'image'), element('h3', '', loading ? 'Buscando nuestros recuerdos…' : 'Toda historia empieza con un momento.'), element('p', 'muted', loading ? 'Un instante, ya casi estamos.' : 'Sube nuestra primera foto y guardémosla aquí, juntos.'));
    }
    container.append(empty);
    return;
  }
  let index = 0;
  for (const group of groupByMonth(photos)) {
    const section = element('section', 'month-group');
    const heading = element('h3', 'month-heading');
    heading.append(element('span', '', group.label), element('span', 'month-count', `${group.items.length}`));
    heading.lastChild.setAttribute('aria-label', `${group.items.length} ${group.items.length === 1 ? 'recuerdo' : 'recuerdos'}`);
    section.setAttribute('aria-label', group.label);
    const grid = element('div', 'photo-grid');
    for (const photo of group.items) grid.append(card(photo, index++, urls, { onOpen, onDelete, onEdit, onImageError, editable }));
    section.append(heading, grid);
    container.append(section);
  }
}
