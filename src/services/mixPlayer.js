// Lógica del MIX DE RECUERDOS, independiente del DOM para poder probarla.
import { groupByMonth, sortChronological } from './memories.js';

export const MIX_MIN_ITEMS = 2;
export const MIX_SECONDS = Object.freeze([3, 4, 6, 8]);
export const TITLE_MS = 2600;

// Diapositivas en orden cronológico ascendente con un separador por mes.
export function buildMixSlides(rows) {
  const slides = [];
  for (const [index, group] of groupByMonth(sortChronological(rows, 'asc')).entries()) {
    const title = group.month ? (index === 0 ? `Nuestros recuerdos de ${group.label.toLocaleLowerCase('es')}` : group.label) : 'Recuerdos sin fecha';
    slides.push({ kind: 'title', title, count: group.items.length });
    for (const memory of group.items) slides.push({ kind: 'memory', memory });
  }
  return slides;
}

export function countMemories(slides) { return slides.filter((slide) => slide.kind === 'memory').length; }

/**
 * Controla el avance automático, la pausa y la navegación.
 * Los videos avanzan cuando terminan (videoEnded) o por un tiempo máximo de seguridad.
 */
export function createMixController({ slides, photoSeconds = 4, titleMs = TITLE_MS, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} }) {
  if (!slides?.length) throw new RangeError('El MIX necesita al menos una diapositiva.');
  let index = 0;
  let playing = true;
  let finished = false;
  let stopped = false;
  let timer = null;
  let photoMs = photoSeconds * 1000;

  function durationFor(slide) {
    if (slide.kind === 'title') return titleMs;
    if (slide.memory.media_type === 'video') return (Number(slide.memory.duration_seconds) || 15) * 1000 + 3000;
    return photoMs;
  }
  function cancel() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function schedule() {
    cancel();
    if (!playing || stopped || finished) return;
    timer = setTimer(() => { timer = null; advance(true); }, durationFor(slides[index]));
  }
  function emit() { onChange(api.state()); }
  function go(target) {
    if (stopped) return;
    index = Math.max(0, Math.min(slides.length - 1, target));
    finished = false;
    emit();
    schedule();
  }
  function advance(automatic = false) {
    if (stopped) return;
    if (index < slides.length - 1) return go(index + 1);
    if (automatic) { finished = true; playing = false; cancel(); emit(); }
  }
  const api = {
    state() { return { index, total: slides.length, slide: slides[index], playing, finished, stopped, photoSeconds: photoMs / 1000 }; },
    start() { emit(); schedule(); },
    next() { advance(false); },
    previous() { go(index - 1); },
    goTo(target) { go(target); },
    pause() { if (stopped || !playing) return; playing = false; cancel(); emit(); },
    resume() {
      if (stopped || playing) return;
      if (finished) { index = 0; finished = false; }
      playing = true; emit(); schedule();
    },
    toggle() { if (playing) api.pause(); else api.resume(); },
    videoEnded() { if (playing && slides[index].kind === 'memory' && slides[index].memory.media_type === 'video') advance(true); },
    setPhotoSeconds(seconds) {
      if (!MIX_SECONDS.includes(Number(seconds))) return;
      photoMs = Number(seconds) * 1000;
      emit();
      schedule();
    },
    stop() { stopped = true; playing = false; cancel(); },
  };
  return api;
}
