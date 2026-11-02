export const USER_ID = '10000000-0000-4000-8000-000000000001'; // Ficticio: solo pruebas.
export const PHOTO_ID = '20000000-0000-4000-8000-000000000001';
export const examplePhoto = { id: PHOTO_ID, storage_path: `originals/${USER_ID}/${PHOTO_ID}.png`, thumbnail_path: `thumbnails/${USER_ID}/${PHOTO_ID}.webp`, original_name: 'recuerdo.png', uploaded_by: USER_ID, created_at: '2026-01-01T12:00:00Z' };
export function imageFile() { return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'recuerdo.png', { type: 'image/png' }); }

export function mockClient(options = {}) {
  const database = { records: options.records || [], events: [], ...options };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = 'select'; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
    neq(column, value) { this.filters.push((row) => row[column] !== value); return this; }
    in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
    limit() { return this; }
    range() { return this; }
    order() { return this; }
    insert(row) { this.row = row; this.operation = 'insert'; return this; }
    delete() { this.operation = 'delete'; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    async then(resolve, reject) {
      try {
        database.events.push(this.operation);
        let result;
        if (this.operation === 'insert') {
          if (!database.insertError || database.commitOnError) database.records.push(this.row);
          result = { data: database.insertError ? null : this.row, error: database.insertError || null };
        } else if (this.operation === 'delete') {
          const matching = database.records.filter((row) => this.filters.every((filter) => filter(row)));
          if (!database.deleteError) database.records = database.records.filter((row) => !matching.includes(row));
          result = { data: matching, error: database.deleteError || null };
        } else {
          const rows = database.records.filter((row) => this.filters.every((filter) => filter(row)));
          result = { data: this.one ? rows[0] || null : rows, error: database.readError || null };
        }
        resolve(result);
      } catch (error) { reject(error); }
    }
  }
  return { database, supabaseUrl: 'https://example.supabase.co', auth: { async getUser() { return { data: { user: { id: USER_ID } }, error: null }; } }, from(table) { return new Query(table); } };
}

export function mockStorage(options = {}) {
  return {
    events: [],
    async upload(path) { this.events.push(['upload', path]); if (options.uploadError) throw options.uploadError; },
    async remove(paths) { this.events.push(['remove', paths]); if (options.removeError) throw options.removeError; },
  };
}
