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
    update(changes) { this.changes = changes; this.operation = 'update'; return this; }
    delete() { this.operation = 'delete'; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    async then(resolve, reject) {
      try {
        database.events.push(this.operation);
        let result;
        // Simula una base sin la migración v2: PostgREST responde 42703 al pedir columnas nuevas.
        if (database.missingColumns && /media_type/.test(this.columns || '')) {
          result = { data: null, error: { code: '42703', message: 'column album_photos.media_type does not exist' } };
        } else if (this.operation === 'update') {
          const matching = database.records.filter((row) => this.filters.every((filter) => filter(row)));
          if (!database.updateDenied) for (const row of matching) Object.assign(row, this.changes);
          result = { data: database.updateDenied ? null : matching[0] || null, error: database.updateError || null };
        } else if (this.operation === 'insert') {
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

// Construye un MP4 mínimo (ftyp + moov con mvhd y pistas) para probar el validador sin binarios.
export function buildMp4({ brand = 'isom', compatible = ['isom', 'avc1', 'mp41'], timescale = 1000, duration = 3000, video = 'avc1', audio = 'mp4a', version = 0 } = {}) {
  const box = (type, ...parts) => {
    const body = Buffer.concat(parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
  };
  const uint = (value, bytes = 4) => { const b = Buffer.alloc(bytes); if (bytes === 8) b.writeBigUInt64BE(BigInt(value)); else b.writeUInt32BE(value); return b; };
  const mvhd = version === 1
    ? box('mvhd', Buffer.from([1, 0, 0, 0]), uint(0, 8), uint(0, 8), uint(timescale), uint(duration, 8), Buffer.alloc(80))
    : box('mvhd', Buffer.from([0, 0, 0, 0]), uint(0), uint(0), uint(timescale), uint(duration), Buffer.alloc(80));
  const track = (handler, codec) => box('trak', box('mdia',
    box('hdlr', Buffer.alloc(4), Buffer.alloc(4), Buffer.from(handler, 'latin1'), Buffer.alloc(12)),
    box('minf', box('stbl', box('stsd', Buffer.alloc(4), uint(1), box(codec, Buffer.alloc(8)))))));
  const tracks = [video && track('vide', video), audio && track('soun', audio)].filter(Boolean);
  return Buffer.concat([box('ftyp', Buffer.from(brand, 'latin1'), uint(0), ...compatible.map((item) => Buffer.from(item, 'latin1'))), box('moov', mvhd, ...tracks), box('mdat', Buffer.alloc(16))]);
}

export function videoFile(bytes, name = 'abrazo.mp4', type = 'video/mp4') { return new File([bytes], name, { type }); }

export function mockStorage(options = {}) {
  return {
    events: [],
    async upload(path) { this.events.push(['upload', path]); if (options.uploadError) throw options.uploadError; },
    async remove(paths) { this.events.push(['remove', paths]); if (options.removeError) throw options.removeError; },
  };
}
