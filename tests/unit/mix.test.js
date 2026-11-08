import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMixSlides, countMemories, createMixController } from '../../src/services/mixPlayer.js';

const memory = (id, date, extra = {}) => ({ id, memory_date: date, created_at: '2026-06-01T12:00:00Z', media_type: 'photo', ...extra });
const rows = [memory('feb', '2026-02-14'), memory('ene2', '2026-01-20'), memory('ene1', '2026-01-03'), memory('vid', '2026-02-20', { media_type: 'video', duration_seconds: 5 })];

// Temporizador manual: permite avanzar el tiempo en las pruebas.
function clock() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    setTimer(fn, ms) { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer(id) { timers.delete(id); },
    tick(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    get pending() { return timers.size; },
  };
}

test('organiza el MIX cronológicamente con separadores por mes', () => {
  const slides = buildMixSlides(rows);
  assert.deepEqual(slides.map((slide) => slide.kind === 'title' ? slide.title : slide.memory.id), ['Nuestros recuerdos de enero de 2026', 'ene1', 'ene2', 'Febrero de 2026', 'feb', 'vid']);
  assert.equal(countMemories(slides), 4);
  assert.equal(slides[0].count, 2);
});

test('avanza automáticamente con la duración configurada y termina al final', () => {
  const time = clock();
  const states = [];
  const mix = createMixController({ slides: buildMixSlides(rows.slice(0, 3)), photoSeconds: 4, titleMs: 2000, ...time, onChange: (state) => states.push(state) });
  mix.start();
  assert.equal(mix.state().index, 0);
  time.tick(1999);
  assert.equal(mix.state().index, 0);
  time.tick(1);
  assert.equal(mix.state().index, 1); // Título -> primera foto
  time.tick(4000);
  assert.equal(mix.state().index, 2);
  time.tick(4000 + 2000 + 4000);
  assert.equal(mix.state().finished, true);
  assert.equal(mix.state().playing, false);
  assert.equal(time.pending, 0);
  assert.ok(states.length >= 5);
});

test('avanzar, retroceder y límites', () => {
  const time = clock();
  const mix = createMixController({ slides: buildMixSlides(rows), ...time });
  mix.start();
  mix.previous();
  assert.equal(mix.state().index, 0);
  mix.next(); mix.next();
  assert.equal(mix.state().index, 2);
  mix.previous();
  assert.equal(mix.state().index, 1);
  mix.goTo(99);
  assert.equal(mix.state().index, 5);
  mix.next(); // En la última diapositiva, avanzar manualmente no la cierra.
  assert.equal(mix.state().index, 5);
  assert.equal(mix.state().finished, false);
});

test('pausar detiene el avance y reanudar lo continúa', () => {
  const time = clock();
  const mix = createMixController({ slides: buildMixSlides(rows), photoSeconds: 4, ...time });
  mix.start();
  mix.next();
  mix.pause();
  assert.equal(mix.state().playing, false);
  time.tick(60_000);
  assert.equal(mix.state().index, 1);
  mix.resume();
  time.tick(4000);
  assert.equal(mix.state().index, 2);
  mix.toggle();
  assert.equal(mix.state().playing, false);
  mix.toggle();
  assert.equal(mix.state().playing, true);
});

test('los videos avanzan al terminar y tienen un tiempo máximo de seguridad', () => {
  const time = clock();
  const slides = buildMixSlides(rows);
  const mix = createMixController({ slides, ...time });
  mix.start();
  mix.goTo(slides.findIndex((slide) => slide.memory?.media_type === 'video'));
  mix.goTo(4); // foto
  mix.videoEnded(); // Ignorado: no es un video.
  assert.equal(mix.state().index, 4);
  mix.goTo(5);
  time.tick(7000);
  assert.equal(mix.state().index, 5); // 5 s de video + 3 s de margen aún no se cumplen.
  time.tick(1000);
  assert.equal(mix.state().finished, true);
  mix.goTo(5);
  mix.resume();
  mix.videoEnded();
  assert.equal(mix.state().finished, true);
});

test('cambiar la duración por foto y detener inmediatamente', () => {
  const time = clock();
  const mix = createMixController({ slides: buildMixSlides(rows), photoSeconds: 4, titleMs: 1000, ...time });
  mix.start();
  time.tick(1000);
  mix.setPhotoSeconds(8);
  assert.equal(mix.state().photoSeconds, 8);
  mix.setPhotoSeconds(99); // Valor no permitido: se ignora.
  assert.equal(mix.state().photoSeconds, 8);
  time.tick(7999);
  assert.equal(mix.state().index, 1);
  mix.stop();
  time.tick(60_000);
  assert.equal(mix.state().index, 1);
  assert.equal(time.pending, 0);
  mix.next();
  assert.equal(mix.state().index, 1);
});

test('reanudar al final reinicia desde el principio', () => {
  const time = clock();
  const mix = createMixController({ slides: buildMixSlides(rows.slice(0, 2)), photoSeconds: 3, titleMs: 1000, ...time });
  mix.start();
  time.tick(60_000);
  assert.equal(mix.state().finished, true);
  mix.resume();
  assert.equal(mix.state().index, 0);
  assert.equal(mix.state().playing, true);
  assert.throws(() => createMixController({ slides: [] }), /al menos una/);
});
