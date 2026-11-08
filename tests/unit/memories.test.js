import test from 'node:test';
import assert from 'node:assert/strict';
import { availableMonths, availablePlaces, availableYears, filterMemories, formatMemoryDate, groupByMonth, memoryDate, monthLabel, NO_PLACE, normalizePlace, parseMemoryDate, reconcileFilters, sortChronological } from '../../src/services/memories.js';

const row = (id, memory_date, extra = {}) => ({ id, memory_date, created_at: '2026-06-15T15:00:00Z', media_type: 'photo', place: null, ...extra });
const rows = [
  row('a', '2025-12-24', { place: 'Casa' }),
  row('b', '2026-01-10', { place: 'Paracas', media_type: 'video' }),
  row('c', '2026-01-02', { place: 'paracas' }),
  row('d', '2026-03-08', { place: 'Miraflores' }),
  row('e', null, { created_at: '2026-02-20T15:00:00Z' }), // Antiguo: sin fecha del recuerdo ni lugar.
];

test('fecha efectiva: fecha del recuerdo o, como respaldo, la fecha de subida marcada como no exacta', () => {
  assert.deepEqual(memoryDate(rows[0]), { year: 2025, month: 12, day: 24, exact: true, key: '2025-12-24' });
  const fallback = memoryDate(rows[4]);
  assert.equal(fallback.exact, false);
  assert.equal(fallback.year, 2026);
  assert.equal(fallback.month, 2);
  assert.equal(memoryDate({ created_at: 'no-es-fecha' }), null);
  assert.match(formatMemoryDate(rows[4]), /^Subida el/);
  assert.equal(formatMemoryDate(rows[0]), '24 de diciembre de 2025');
});

test('filtra por año', () => {
  assert.deepEqual(filterMemories(rows, { year: '2026' }).map((item) => item.id), ['b', 'c', 'd', 'e']);
  assert.deepEqual(filterMemories(rows, { year: '2025' }).map((item) => item.id), ['a']);
});

test('filtra por mes dentro del año (el mes sin año se ignora)', () => {
  assert.deepEqual(filterMemories(rows, { year: '2026', month: '1' }).map((item) => item.id), ['b', 'c']);
  assert.equal(filterMemories(rows, { month: '1' }).length, rows.length);
});

test('filtra por lugar sin distinguir mayúsculas y por recuerdos sin lugar', () => {
  assert.deepEqual(filterMemories(rows, { place: 'Paracas' }).map((item) => item.id), ['b', 'c']);
  assert.deepEqual(filterMemories(rows, { place: NO_PLACE }).map((item) => item.id), ['e']);
});

test('filtra por tipo de contenido y combina filtros', () => {
  assert.deepEqual(filterMemories(rows, { type: 'video' }).map((item) => item.id), ['b']);
  assert.equal(filterMemories(rows, { type: 'photo' }).length, 4);
  assert.deepEqual(filterMemories(rows, { year: '2026', month: '1', place: 'paracas', type: 'photo' }).map((item) => item.id), ['c']);
  assert.equal(filterMemories(rows, {}).length, 5); // Sin filtros: todos.
});

test('orden cronológico estable en ambos sentidos', () => {
  assert.deepEqual(sortChronological(rows, 'asc').map((item) => item.id), ['a', 'c', 'b', 'e', 'd']);
  assert.deepEqual(sortChronological(rows, 'desc').map((item) => item.id), ['d', 'e', 'b', 'c', 'a']);
  const ties = [row('x', '2026-01-01', { created_at: '2026-01-02T00:00:00Z' }), row('y', '2026-01-01', { created_at: '2026-01-01T00:00:00Z' })];
  assert.deepEqual(sortChronological(ties, 'asc').map((item) => item.id), ['y', 'x']);
});

test('agrupa por año y mes respetando el orden recibido', () => {
  const groups = groupByMonth(sortChronological(rows, 'desc'));
  assert.deepEqual(groups.map((group) => [group.label, group.items.length]), [['Marzo de 2026', 1], ['Febrero de 2026', 1], ['Enero de 2026', 2], ['Diciembre de 2025', 1]]);
  assert.equal(monthLabel(2026, 9), 'Septiembre de 2026');
});

test('años, meses y lugares se generan dinámicamente desde el contenido', () => {
  assert.deepEqual(availableYears(rows), [2026, 2025]);
  assert.deepEqual(availableMonths(rows, '2026'), [1, 2, 3]);
  assert.deepEqual(availableMonths(rows, ''), []);
  assert.deepEqual(availablePlaces(rows), ['Casa', 'Miraflores', 'Paracas']);
});

test('corrige filtros que ya no tienen contenido', () => {
  assert.deepEqual(reconcileFilters(rows, { year: '2024', month: '5', place: '', type: '' }), { year: '', month: '', place: '', type: '' });
  assert.deepEqual(reconcileFilters(rows, { year: '2026', month: '7', place: 'Lima', type: 'audio' }), { year: '2026', month: '', place: '', type: '' });
  assert.equal(reconcileFilters(rows, { place: NO_PLACE }).place, NO_PLACE);
});

test('valida la fecha editada y normaliza el lugar', () => {
  const today = new Date(2026, 10, 6);
  assert.equal(parseMemoryDate('', today), null);
  assert.equal(parseMemoryDate('2026-02-14', today), '2026-02-14');
  assert.throws(() => parseMemoryDate('2026-02-30', today), /no existe/);
  assert.throws(() => parseMemoryDate('14/02/2026', today), /AAAA-MM-DD/);
  assert.throws(() => parseMemoryDate('2026-12-01', today), /entre 1900 y hoy/);
  assert.throws(() => parseMemoryDate('1899-12-31', today), /entre 1900 y hoy/);
  assert.equal(normalizePlace('  Nuestro\n primer   restaurante '), 'Nuestro primer restaurante');
  assert.equal(normalizePlace('x'.repeat(200)).length, 80);
  assert.equal(normalizePlace(null), '');
});
