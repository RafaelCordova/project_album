import { button, element, icon } from './ui.js';
import { availableMonths, availablePlaces, availableYears, capitalize, hasFilters, MONTHS, NO_PLACE } from '../services/memories.js';

function select(id, label, className) {
  const wrap = element('div', `filter-field ${className}`);
  const caption = element('label', '', label);
  caption.htmlFor = id;
  const node = element('select');
  node.id = id;
  node.name = id;
  wrap.append(caption, node);
  return { wrap, node };
}

function options(node, items, value) {
  node.replaceChildren(...items.map(([optionValue, text]) => {
    const option = element('option', '', text);
    option.value = optionValue;
    return option;
  }));
  node.value = items.some(([optionValue]) => optionValue === value) ? value : '';
}

// Barra de filtros. Devuelve { node, update(rows, filters) }; los cambios se notifican con onChange.
export function createFilters({ onChange }) {
  const node = element('div', 'filters');
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', 'Filtrar recuerdos');
  const year = select('filter-year', 'Año', 'filter-year');
  const month = select('filter-month', 'Mes', 'filter-month');
  const place = select('filter-place', 'Lugar', 'filter-place');
  const type = select('filter-type', 'Tipo', 'filter-type');
  const reset = button('Ver todos', 'refresh', 'button secondary compact filter-reset');
  const summary = element('p', 'filter-summary');
  summary.setAttribute('aria-live', 'polite');
  node.append(year.wrap, month.wrap, place.wrap, type.wrap, reset, summary);
  let current = {};
  const emit = (patch) => onChange({ ...current, ...patch });
  year.node.addEventListener('change', () => emit({ year: year.node.value, month: '' }));
  month.node.addEventListener('change', () => emit({ month: month.node.value }));
  place.node.addEventListener('change', () => emit({ place: place.node.value }));
  type.node.addEventListener('change', () => emit({ type: type.node.value }));
  reset.addEventListener('click', () => onChange({ year: '', month: '', place: '', type: '' }));
  return {
    node,
    update(rows, filters, shown, { videos = true } = {}) {
      current = { ...filters };
      options(year.node, [['', 'Todos los años'], ...availableYears(rows).map((value) => [String(value), String(value)])], filters.year);
      options(month.node, [['', filters.year ? 'Todos los meses' : 'Elige un año'], ...availableMonths(rows, filters.year).map((value) => [String(value), capitalize(MONTHS[value - 1])])], filters.month);
      month.node.disabled = !filters.year;
      const places = availablePlaces(rows);
      const placeItems = [['', 'Todos los lugares'], ...places.map((value) => [value, value])];
      if (rows.some((row) => !row.place)) placeItems.push([NO_PLACE, 'Sin lugar']);
      options(place.node, placeItems, filters.place);
      options(type.node, [['', 'Fotos y videos'], ['photo', 'Solo fotografías'], ...(videos ? [['video', 'Solo videos']] : [])], filters.type);
      reset.hidden = !hasFilters(filters);
      summary.textContent = hasFilters(filters) ? `Mostrando ${shown} de ${rows.length} recuerdos.` : '';
      node.hidden = rows.length === 0;
    },
  };
}

export function mixButton(onClick) {
  const node = element('button', 'button mix-button');
  node.type = 'button';
  node.append(icon('sparkle'), element('span', '', 'MIX DE RECUERDOS'));
  node.addEventListener('click', onClick);
  return node;
}
