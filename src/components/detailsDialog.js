import { button, element, icon } from './ui.js';
import { placeList } from './uploadPanel.js';
import { PLACE_MAX_LENGTH } from '../config/media.js';

// Diálogo para editar la fecha del recuerdo y el lugar. No toca archivos ni rutas.
export function createDetailsDialog({ onSave }) {
  const dialog = element('dialog', 'details-dialog');
  dialog.setAttribute('aria-labelledby', 'details-heading');
  const form = element('form', 'details-form');
  form.method = 'dialog';
  const heading = element('h2', '', 'Fecha y lugar del recuerdo');
  heading.id = 'details-heading';
  const name = element('p', 'confirm-filename');
  const dateLabel = element('label', '', 'Fecha del recuerdo');
  dateLabel.htmlFor = 'details-date';
  const date = element('input');
  Object.assign(date, { id: 'details-date', name: 'memory_date', type: 'date', min: '1900-01-01' });
  const dateHint = element('p', 'field-hint', 'Déjala vacía para usar la fecha de subida.');
  const placeLabel = element('label', '', 'Lugar');
  placeLabel.htmlFor = 'details-place';
  const place = element('input');
  Object.assign(place, { id: 'details-place', name: 'place', type: 'text', maxLength: PLACE_MAX_LENGTH, placeholder: 'Ej.: Miraflores', autocomplete: 'off' });
  place.setAttribute('list', 'details-places');
  let datalist = placeList('details-places', []);
  const status = element('p', 'form-status');
  status.setAttribute('role', 'status');
  const cancel = button('Cancelar', null, 'button secondary');
  const save = button('Guardar cambios', 'check', 'button primary');
  save.type = 'submit';
  const actions = element('div', 'dialog-actions');
  actions.append(cancel, save);
  form.append(heading, name, dateLabel, date, dateHint, placeLabel, place, datalist, status, actions);
  dialog.append(icon('calendar'), form);
  let current = null;
  let busy = false;
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!current || busy || !form.reportValidity()) return;
    busy = true;
    save.disabled = true;
    cancel.disabled = true;
    status.textContent = 'Guardando…';
    try {
      await onSave(current, { memoryDate: date.value, place: place.value });
      dialog.close();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; save.disabled = false; cancel.disabled = false; }
  });
  return {
    dialog,
    open(photo, places) {
      current = photo;
      name.textContent = photo.original_name;
      const now = new Date();
      date.max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      date.value = photo.memory_date || '';
      place.value = photo.place || '';
      const list = placeList('details-places', places);
      datalist.replaceWith(list);
      datalist = list;
      status.textContent = '';
      dialog.showModal();
      date.focus();
    },
  };
}
