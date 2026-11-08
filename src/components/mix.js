import { button, element, icon } from './ui.js';
import { buildMixSlides, countMemories, createMixController, MIX_MIN_ITEMS, MIX_SECONDS } from '../services/mixPlayer.js';
import { formatMemoryDate, mediaType, normalizePlace } from '../services/memories.js';

// Imagen del MIX: versión optimizada. El original solo se usa si no existe ninguna versión optimizada.
export function mixImagePath(memory) {
  return memory.display_path || memory.thumbnail_path || memory.storage_path;
}

/**
 * Presentación a pantalla completa. Solo existe un <video> a la vez y únicamente se
 * precarga la siguiente fotografía. `sign(paths)` devuelve un Map de URLs firmadas.
 */
export function createMix({ sign }) {
  const dialog = element('dialog', 'mix');
  dialog.setAttribute('aria-label', 'Mix de recuerdos');
  dialog.setAttribute('aria-roledescription', 'presentación');
  const top = element('div', 'mix-top');
  const title = element('p', 'mix-brand');
  title.append(icon('heart'), element('span', '', 'Mix de recuerdos'));
  const counter = element('p', 'mix-counter');
  const close = button('Cerrar presentación', 'close', 'icon-button mix-close');
  top.append(title, counter, close);
  const stage = element('div', 'mix-stage');
  const live = element('p', 'visually-hidden');
  live.setAttribute('aria-live', 'polite');
  const bar = element('div', 'mix-progress');
  const controls = element('div', 'mix-controls');
  const previous = button('Recuerdo anterior', 'chevron', 'icon-button mix-previous');
  const toggle = button('Pausar', 'pause', 'icon-button mix-toggle');
  const next = button('Recuerdo siguiente', 'chevron', 'icon-button mix-next');
  const speedWrap = element('label', 'mix-speed');
  const speed = element('select');
  speed.setAttribute('aria-label', 'Segundos por fotografía');
  for (const seconds of MIX_SECONDS) {
    const option = element('option', '', `${seconds} s por foto`);
    option.value = String(seconds);
    speed.append(option);
  }
  speed.value = '4';
  speedWrap.append(speed);
  const sound = button('Activar sonido de los videos', 'mute', 'icon-button mix-sound');
  const status = element('p', 'mix-status');
  status.setAttribute('role', 'status');
  controls.append(previous, toggle, next, speedWrap, sound);
  dialog.append(top, stage, bar, status, controls, live);

  let controller = null;
  let slides = [];
  let current = null; // { node, video }
  let muted = true;
  let session = 0;

  function setToggle(playing) {
    toggle.replaceChildren(icon(playing ? 'pause' : 'play'), element('span', '', playing ? 'Pausar' : 'Reanudar'));
    toggle.setAttribute('aria-label', playing ? 'Pausar presentación' : 'Reanudar presentación');
    toggle.title = playing ? 'Pausar' : 'Reanudar';
    toggle.setAttribute('aria-pressed', String(!playing));
  }
  function setSound() {
    sound.replaceChildren(icon(muted ? 'mute' : 'volume'), element('span', '', muted ? 'Activar sonido de los videos' : 'Silenciar videos'));
    sound.setAttribute('aria-label', muted ? 'Activar sonido de los videos' : 'Silenciar videos');
    sound.title = sound.getAttribute('aria-label');
    sound.setAttribute('aria-pressed', String(!muted));
    if (current?.video) current.video.muted = muted;
  }
  function unload(entry) {
    if (!entry) return;
    if (entry.video) { entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load(); }
    entry.node.classList.remove('is-active');
    entry.node.classList.add('is-leaving');
    setTimeout(() => entry.node.remove(), 700);
  }
  function progress(state) {
    bar.replaceChildren();
    const slide = state.slide;
    if (!state.playing || (slide.kind === 'memory' && mediaType(slide.memory) === 'video')) return;
    const fill = element('span');
    fill.style.setProperty('--mix-duration', `${slide.kind === 'title' ? 2.6 : state.photoSeconds}s`);
    bar.append(fill);
  }
  function caption(memory) {
    const node = element('div', 'mix-caption');
    node.append(element('p', 'mix-date', formatMemoryDate(memory)));
    const place = normalizePlace(memory.place);
    if (place) { const line = element('p', 'mix-place'); line.append(icon('pin'), element('span', '', place)); node.append(line); }
    return node;
  }
  async function preload(index) {
    const slide = slides.slice(index + 1).find((item) => item.kind === 'memory');
    if (!slide || mediaType(slide.memory) === 'video') return;
    try {
      const path = mixImagePath(slide.memory);
      const url = (await sign([path])).get(path);
      if (url) { const image = new Image(); image.referrerPolicy = 'no-referrer'; image.decoding = 'async'; image.src = url; }
    } catch { /* La precarga es opcional. */ }
  }
  async function render(state) {
    const mySession = session;
    const slide = state.slide;
    counter.textContent = `${state.index + 1} / ${state.total}`;
    previous.disabled = state.index === 0;
    next.disabled = state.index === state.total - 1;
    setToggle(state.playing);
    progress(state);
    status.textContent = state.finished ? 'Fin del mix. Pulsa reanudar para verlo otra vez.' : '';
    if (current?.index === state.index) {
      // Misma diapositiva: solo cambia el estado de reproducción.
      if (current.video) { if (state.playing) playVideo(current.video); else current.video.pause(); }
      return;
    }
    const node = element('div', `mix-slide mix-${slide.kind === 'title' ? 'title' : mediaType(slide.memory)}`);
    const entry = { node, video: null, index: state.index };
    if (slide.kind === 'title') {
      const heart = icon('heart');
      heart.classList.add('mix-title-heart');
      node.append(heart, element('h2', '', slide.title), element('p', '', slide.count === 1 ? '1 recuerdo' : `${slide.count} recuerdos`));
      live.textContent = slide.title;
    } else {
      const memory = slide.memory;
      live.textContent = `${formatMemoryDate(memory)}${memory.place ? `, ${memory.place}` : ''}`;
      const frame = element('div', 'mix-frame');
      node.append(frame, caption(memory));
      if (mediaType(memory) === 'video') {
        const video = element('video', 'mix-media');
        Object.assign(video, { muted, playsInline: true, controls: true, preload: 'none' });
        video.setAttribute('aria-label', memory.original_name);
        video.addEventListener('ended', () => controller?.videoEnded());
        entry.video = video;
        frame.append(video);
        void (async () => {
          try {
            const paths = [memory.storage_path, memory.thumbnail_path].filter(Boolean);
            const urls = await sign(paths);
            if (mySession !== session || current !== entry) return;
            if (memory.thumbnail_path && urls.get(memory.thumbnail_path)) video.poster = urls.get(memory.thumbnail_path);
            const url = urls.get(memory.storage_path);
            if (!url) throw new Error('sin url');
            video.src = url;
            if (controller?.state().playing) playVideo(video);
          } catch { if (mySession === session && current === entry) status.textContent = 'No se pudo cargar este video. Puedes pasar al siguiente.'; }
        })();
      } else {
        const backdrop = element('img', 'mix-backdrop');
        backdrop.alt = '';
        const image = element('img', 'mix-media');
        image.alt = memory.original_name;
        for (const img of [backdrop, image]) { img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; }
        frame.prepend(backdrop);
        frame.append(image);
        image.addEventListener('error', () => { if (current === entry) status.textContent = 'No se pudo cargar esta fotografía.'; });
        void (async () => {
          try {
            const path = mixImagePath(memory);
            const url = (await sign([path])).get(path);
            if (mySession !== session || current !== entry || !url) return;
            image.src = url;
            backdrop.src = url;
          } catch { if (mySession === session && current === entry) status.textContent = 'No se pudo cargar esta fotografía.'; }
        })();
      }
    }
    const previousEntry = current;
    current = entry;
    stage.append(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-active')));
    unload(previousEntry);
    void preload(state.index);
  }
  function playVideo(video) {
    if (!video.src) return;
    video.muted = muted;
    const attempt = video.play();
    attempt?.catch?.(() => {
      // Autoplay bloqueado por el navegador: se pausa la presentación y se pide un toque.
      controller?.pause();
      status.textContent = 'Pulsa reanudar para reproducir el video.';
    });
  }
  function shutdown() {
    session++;
    controller?.stop();
    controller = null;
    unload(current);
    current = null;
    stage.replaceChildren();
    bar.replaceChildren();
  }

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', shutdown);
  previous.addEventListener('click', () => controller?.previous());
  next.addEventListener('click', () => controller?.next());
  toggle.addEventListener('click', () => controller?.toggle());
  speed.addEventListener('change', () => controller?.setPhotoSeconds(Number(speed.value)));
  sound.addEventListener('click', () => { muted = !muted; setSound(); });
  dialog.addEventListener('keydown', (event) => {
    if (!controller || ['SELECT', 'VIDEO', 'INPUT'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); controller.next(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); controller.previous(); }
    else if (event.key === ' ' && event.target.tagName !== 'BUTTON') { event.preventDefault(); controller.toggle(); }
  });

  return {
    dialog,
    get controller() { return controller; },
    // Devuelve false si no hay suficientes recuerdos (el llamador muestra el aviso).
    open(rows) {
      const built = buildMixSlides(rows);
      if (countMemories(built) < MIX_MIN_ITEMS) return false;
      shutdown();
      session++;
      slides = built;
      muted = true;
      setSound();
      controller = createMixController({ slides, photoSeconds: Number(speed.value), onChange: (state) => void render(state) });
      dialog.showModal();
      toggle.focus();
      controller.start();
      return true;
    },
  };
}
