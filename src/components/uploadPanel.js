import { button, element, icon } from './ui.js';
import { PLACE_MAX_LENGTH } from '../config/media.js';

function todayValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function formatSize(bytes) {
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

export function placeList(id, places) {
  const list = element('datalist');
  list.id = id;
  list.replaceChildren(...places.map((place) => { const option = element('option'); option.value = place; return option; }));
  return list;
}

/**
 * Vista previa de la selección antes de subir. Los archivos se muestran con URLs blob locales
 * que se revocan al cancelar o terminar. Nada se envía a Supabase hasta pulsar «Guardar».
 */
export function createUploadPanel({ onConfirm, onCancel }) {
  const node = element('div', 'upload-panel');
  node.hidden = true;
  const heading = element('h3', 'upload-panel-title');
  const previews = element('ul', 'upload-previews');
  const fields = element('div', 'upload-fields');
  const dateLabel = element('label', '', 'Fecha del recuerdo (opcional)');
  dateLabel.htmlFor = 'upload-date';
  const date = element('input');
  Object.assign(date, { id: 'upload-date', name: 'memory_date', type: 'date', min: '1900-01-01' });
  const placeLabel = element('label', '', 'Lugar (opcional)');
  placeLabel.htmlFor = 'upload-place';
  const place = element('input');
  Object.assign(place, { id: 'upload-place', name: 'place', type: 'text', maxLength: PLACE_MAX_LENGTH, placeholder: 'Ej.: Paracas, Casa, Nuestro viaje', autocomplete: 'off' });
  place.setAttribute('list', 'upload-places');
  let datalist = placeList('upload-places', []);
  fields.append(dateLabel, date, placeLabel, place, datalist);
  const hint = element('p', 'upload-panel-hint', 'Si no eliges fecha, se usará la fecha de subida. Podrás cambiarla después.');
  const progress = element('progress', 'upload-progress');
  progress.max = 1;
  progress.value = 0;
  progress.hidden = true;
  progress.setAttribute('aria-label', 'Progreso de la subida');
  const actions = element('div', 'upload-panel-actions');
  const cancel = button('Cancelar', 'close', 'button secondary compact upload-cancel');
  const confirm = button('Guardar en el álbum', 'upload', 'button primary compact upload-confirm');
  actions.append(cancel, confirm);
  node.append(heading, previews, fields, hint, progress, actions);
  let items = [];
  const urls = [];

  function release() {
    for (const media of previews.querySelectorAll('video')) { media.pause(); media.removeAttribute('src'); media.load(); }
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  }
  function refresh() {
    heading.textContent = items.length === 1 ? 'Listo para guardar: 1 recuerdo' : `Listos para guardar: ${items.length} recuerdos`;
    confirm.disabled = !items.length;
    if (!items.length) panel.clear();
  }
  function tile(item) {
    const row = element('li', `upload-preview${item.kind === 'video' ? ' is-video' : ''}`);
    const url = URL.createObjectURL(item.file);
    urls.push(url);
    let media;
    if (item.kind === 'video') {
      media = element('video');
      Object.assign(media, { src: url, muted: true, playsInline: true, controls: true, preload: 'metadata' });
      media.setAttribute('aria-label', `Vista previa de ${item.file.name}`);
    } else {
      media = element('img');
      Object.assign(media, { src: url, alt: `Vista previa de ${item.file.name}`, decoding: 'async' });
    }
    const caption = element('span', 'upload-preview-name', item.file.name);
    caption.title = item.file.name;
    const meta = element('span', 'upload-preview-meta', `${item.kind === 'video' ? `Video · ${Math.round(item.duration)} s · ` : ''}${formatSize(item.file.size)}`);
    const remove = button(`Quitar ${item.file.name}`, 'close', 'icon-button upload-remove');
    remove.addEventListener('click', () => {
      if (media.tagName === 'VIDEO') { media.pause(); media.removeAttribute('src'); media.load(); }
      URL.revokeObjectURL(url);
      items = items.filter((entry) => entry !== item);
      row.remove();
      refresh();
    });
    row.append(media, caption, meta, remove);
    return row;
  }
  cancel.addEventListener('click', () => { panel.clear(); onCancel(); });
  confirm.addEventListener('click', () => onConfirm(items.map((item) => item.file), { memoryDate: date.value, place: place.value }));

  const panel = {
    node,
    get open() { return !node.hidden; },
    show(next, { places = [], details = true } = {}) {
      release();
      items = [...next];
      previews.replaceChildren(...items.map(tile));
      date.max = todayValue();
      date.value = '';
      place.value = '';
      const list = placeList('upload-places', places);
      datalist.replaceWith(list);
      datalist = list;
      fields.hidden = !details;
      hint.hidden = !details;
      progress.hidden = true;
      node.hidden = !items.length;
      refresh();
    },
    setBusy(busy) {
      for (const control of [cancel, confirm, date, place, ...previews.querySelectorAll('button')]) control.disabled = busy;
      progress.hidden = !busy;
    },
    setProgress(value) { progress.value = Math.max(0, Math.min(1, value)); },
    clear() {
      release();
      items = [];
      previews.replaceChildren();
      node.hidden = true;
      progress.hidden = true;
    },
  };
  return panel;
}
