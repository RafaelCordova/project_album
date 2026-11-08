// Lógica pura de organización de recuerdos: fecha efectiva, filtros, orden y agrupación.
import { PLACE_MAX_LENGTH } from '../config/media.js';

export const MONTHS = Object.freeze(['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']);
export const EMPTY_FILTERS = Object.freeze({ year: '', month: '', place: '', type: '' });
export const NO_PLACE = '__sin_lugar__';
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (value) => String(value).padStart(2, '0');
export function capitalize(text) { return text ? text[0].toLocaleUpperCase('es') + text.slice(1) : text; }

// Fecha usada para organizar. Si no hay fecha del recuerdo, usa la fecha local de subida
// y lo indica con exact = false (nunca se inventa una fecha histórica).
export function memoryDate(row) {
  const match = DATE_ONLY.exec(row?.memory_date || '');
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), exact: true, key: row.memory_date };
  const uploaded = row?.created_at ? new Date(row.created_at) : null;
  if (!uploaded || Number.isNaN(uploaded.valueOf())) return null;
  const year = uploaded.getFullYear();
  const month = uploaded.getMonth() + 1;
  const day = uploaded.getDate();
  return { year, month, day, exact: false, key: `${year}-${pad(month)}-${pad(day)}` };
}

export function mediaType(row) { return row?.media_type === 'video' ? 'video' : 'photo'; }

export function normalizePlace(value) {
  const place = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return place ? place.slice(0, PLACE_MAX_LENGTH) : '';
}

function compareKey(row) {
  const date = memoryDate(row);
  return `${date?.key || '0000-00-00'}|${row.created_at || ''}|${row.id || ''}`;
}

// Orden cronológico estable: fecha efectiva, luego fecha de subida y luego id.
export function sortChronological(rows, direction = 'desc') {
  const sorted = [...rows].sort((a, b) => compareKey(a).localeCompare(compareKey(b)));
  return direction === 'desc' ? sorted.reverse() : sorted;
}

export function filterMemories(rows, filters = EMPTY_FILTERS) {
  const place = filters.place || '';
  return rows.filter((row) => {
    const date = memoryDate(row);
    if (filters.year && date?.year !== Number(filters.year)) return false;
    if (filters.year && filters.month && date?.month !== Number(filters.month)) return false;
    if (filters.type && mediaType(row) !== filters.type) return false;
    if (place === NO_PLACE) return !normalizePlace(row.place);
    if (place && normalizePlace(row.place).toLocaleLowerCase('es') !== place.toLocaleLowerCase('es')) return false;
    return true;
  });
}

export function hasFilters(filters) { return Boolean(filters.year || filters.month || filters.place || filters.type); }

export function availableYears(rows) {
  return [...new Set(rows.map((row) => memoryDate(row)?.year).filter(Boolean))].sort((a, b) => b - a);
}

export function availableMonths(rows, year) {
  if (!year) return [];
  return [...new Set(rows.map(memoryDate).filter((date) => date?.year === Number(year)).map((date) => date.month))].sort((a, b) => a - b);
}

// Lugares distintos sin distinguir mayúsculas; conserva la primera escritura encontrada.
export function availablePlaces(rows) {
  const places = new Map();
  for (const row of rows) {
    const place = normalizePlace(row.place);
    if (place && !places.has(place.toLocaleLowerCase('es'))) places.set(place.toLocaleLowerCase('es'), place);
  }
  return [...places.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

export function monthLabel(year, month) { return `${capitalize(MONTHS[month - 1])} de ${year}`; }

// Agrupa respetando el orden recibido: [{ key: '2026-03', year, month, label, items }].
export function groupByMonth(rows) {
  const groups = [];
  const index = new Map();
  for (const row of rows) {
    const date = memoryDate(row);
    const key = date ? `${date.year}-${pad(date.month)}` : 'sin-fecha';
    if (!index.has(key)) {
      const group = { key, year: date?.year || null, month: date?.month || null, label: date ? monthLabel(date.year, date.month) : 'Sin fecha', items: [] };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).items.push(row);
  }
  return groups;
}

// Corrige filtros que ya no corresponden al contenido (p. ej. tras eliminar el último recuerdo de un mes).
export function reconcileFilters(rows, filters) {
  const next = { ...EMPTY_FILTERS, ...filters };
  if (next.year && !availableYears(rows).includes(Number(next.year))) { next.year = ''; next.month = ''; }
  if (!next.year) next.month = '';
  if (next.month && !availableMonths(rows, next.year).includes(Number(next.month))) next.month = '';
  if (next.place && next.place !== NO_PLACE && !availablePlaces(rows).some((place) => place.toLocaleLowerCase('es') === next.place.toLocaleLowerCase('es'))) next.place = '';
  if (next.type && !['photo', 'video'].includes(next.type)) next.type = '';
  return next;
}

// Valida una fecha AAAA-MM-DD real, entre 1900 y hoy. Vacío = sin fecha del recuerdo.
export function parseMemoryDate(value, today = new Date()) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = DATE_ONLY.exec(text);
  if (!match) throw new RangeError('Escribe la fecha con el formato AAAA-MM-DD.');
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new RangeError('La fecha no existe.');
  const limit = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (year < 1900 || text > limit) throw new RangeError('La fecha del recuerdo debe estar entre 1900 y hoy.');
  return text;
}

export function formatMemoryDate(row) {
  const date = memoryDate(row);
  if (!date) return 'Fecha no disponible';
  const text = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
  return date.exact ? text : `Subida el ${text}`;
}
