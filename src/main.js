import { config, supabase } from './config/supabase.js';
import { themeFor } from './config/userThemes.js';
import { MAX_FILES_PER_UPLOAD } from './config/media.js';
import { createAuthService } from './services/authService.js';
import { createStorageService } from './services/storageService.js';
import { createPhotoService, PAGE_SIZE } from './services/photoService.js';
import { validateImageSignature } from './services/imageService.js';
import { isVideoFile, validateVideo } from './services/videoService.js';
import { captchaMessage, createCaptcha } from './services/captchaService.js';
import { availablePlaces, EMPTY_FILTERS, filterMemories, formatMemoryDate, hasFilters, mediaType, normalizePlace, reconcileFilters, sortChronological } from './services/memories.js';
import { AlbumError, friendlyError } from './utils/errors.js';
import { authView } from './components/authView.js';
import { cardPath, renderGallery } from './components/gallery.js';
import { createFilters, mixButton } from './components/filters.js';
import { createUploadPanel } from './components/uploadPanel.js';
import { createDetailsDialog } from './components/detailsDialog.js';
import { createMix } from './components/mix.js';
import { brand, button, element, icon, notify } from './components/ui.js';

const app = document.querySelector('#app');
const recoveryFromUrl = new URLSearchParams(location.search).get('recovery') === '1' || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const VIDEO_ACCEPT = '.mp4,video/mp4';
const state = { user: null, identity: null, revision: 0, photos: [], shown: [], urls: new Map(), visible: PAGE_SIZE, filters: { ...EMPTY_FILTERS }, loading: false, busy: false, recovery: recoveryFromUrl, lightboxIndex: -1 };
let view = {};
let auth;
let storage;
let photos;
let signing = false;
let activeCaptcha = null;

function mount(node) {
  activeCaptcha?.destroy();
  activeCaptcha = null;
  app.replaceChildren(node);
  app.setAttribute('aria-busy', 'false');
}
function cleanAuthUrl() { if (location.hash || location.search) history.replaceState(null, '', location.pathname); }
function clearPrivateState() {
  state.revision++;
  state.user = null;
  state.photos = [];
  state.shown = [];
  state.urls.clear();
  state.visible = PAGE_SIZE;
  state.filters = { ...EMPTY_FILTERS };
  state.lightboxIndex = -1;
  state.loading = false;
  state.busy = false;
  storage?.clear();
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  document.querySelector('#notifications').replaceChildren();
  document.documentElement.dataset.theme = 'neutral';
}

function showAuth(mode = 'login') {
  view = {};
  const ui = authView(mode);
  mount(ui.page);
  let submitting = false;
  let captcha = null;
  const captchaTexts = new Set(['pending', 'loading', 'expired', 'error', 'unavailable'].map(captchaMessage));
  const refreshSubmit = () => { ui.submit.disabled = submitting || Boolean(captcha && captcha.state !== 'solved'); };
  if (mode !== 'password' && config.captchaSiteKey) {
    ui.captcha.hidden = false;
    captcha = createCaptcha({
      siteKey: config.captchaSiteKey,
      container: ui.captcha,
      action: mode === 'login' ? 'login' : 'recover',
      onChange: (captchaState) => {
        const problem = ['expired', 'error', 'unavailable'].includes(captchaState);
        ui.captchaRetry.hidden = !problem;
        if (problem) ui.status.textContent = captchaMessage(captchaState);
        else if (captchaState === 'solved' && captchaTexts.has(ui.status.textContent)) ui.status.textContent = '';
        else if (!ui.status.textContent) ui.status.textContent = captchaMessage(captchaState);
        refreshSubmit();
      },
    });
    activeCaptcha = captcha;
    ui.captchaRetry.addEventListener('click', () => { ui.status.textContent = ''; captcha.retry(); });
    refreshSubmit();
  }
  ui.alternate.addEventListener('click', () => mode === 'password' ? void signOut() : showAuth(mode === 'login' ? 'recover' : 'login'));
  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !ui.form.reportValidity()) return;
    const data = new FormData(ui.form);
    if (mode === 'password' && data.get('password') !== data.get('confirm')) {
      ui.status.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    // Sin token vigente no se envía nada: Supabase lo exigiría de todos modos.
    const captchaToken = captcha ? captcha.token() : undefined;
    if (captcha && !captchaToken) { ui.status.textContent = captchaMessage(captcha.state === 'solved' ? 'pending' : captcha.state) || captchaMessage('pending'); return; }
    submitting = true;
    refreshSubmit();
    ui.form.setAttribute('aria-busy', 'true');
    ui.status.textContent = mode === 'login' ? 'Abriendo el álbum…' : 'Un momento…';
    try {
      if (mode === 'login') {
        await auth.signIn(data.get('email'), data.get('password'), captchaToken);
        ui.form.reset();
      } else if (mode === 'recover') {
        await auth.recover(data.get('email'), captchaToken);
        ui.status.textContent = 'Si la cuenta puede recibir correos, te llegará un enlace. Revisa también la carpeta de spam.';
      } else {
        await auth.updatePassword(data.get('password'));
        ui.form.reset();
        state.recovery = false;
        cleanAuthUrl();
        await signOut();
        notify('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
      }
    } catch (error) { ui.status.textContent = friendlyError(error); }
    finally {
      submitting = false;
      // Cada token de Turnstile sirve una sola vez: se pide uno nuevo tras cualquier intento.
      captcha?.reset();
      refreshSubmit();
      ui.form.setAttribute('aria-busy', 'false');
    }
  });
}

function showMessage(title, message, retry) {
  const page = element('main', 'message-page');
  page.id = 'main';
  const card = element('div', 'message-card');
  card.append(brand(), element('h1', '', title), element('p', 'muted', message));
  if (retry) {
    const back = button('Volver a comprobar', 'refresh', 'button primary');
    back.addEventListener('click', retry);
    const logout = button('Cerrar sesión', 'logout', 'button secondary');
    logout.addEventListener('click', () => void signOut());
    card.append(back, logout);
  }
  page.append(card);
  mount(page);
}

async function signOut() {
  try {
    await auth.signOut();
    state.identity = null;
    state.recovery = false;
    clearPrivateState();
    cleanAuthUrl();
    showAuth();
  } catch (error) { notify(friendlyError(error), 'error'); }
}

async function applySession(session, event = '') {
  if (event === 'PASSWORD_RECOVERY') state.recovery = true;
  if (!session) {
    state.identity = null;
    clearPrivateState();
    const badLink = location.hash.includes('error') || location.search.includes('error');
    cleanAuthUrl();
    showAuth();
    if (badLink || state.recovery) notify('El enlace de recuperación no es válido o venció. Solicita uno nuevo.', 'error');
    state.recovery = false;
    return;
  }
  if (state.recovery) {
    state.identity = session.user.id;
    clearPrivateState();
    state.user = session.user;
    cleanAuthUrl();
    showAuth('password');
    return;
  }
  if (state.identity === session.user.id) return;
  state.identity = session.user.id;
  clearPrivateState();
  const revision = state.revision;
  showMessage('Un instante…', 'Comprobando tu acceso al álbum.');
  try {
    const user = await auth.member();
    if (revision !== state.revision) return;
    state.user = user;
    document.documentElement.dataset.theme = themeFor(user.id);
    cleanAuthUrl();
    showAlbum();
    await loadPhotos();
  } catch (error) {
    if (revision !== state.revision) return;
    showMessage('No pudimos abrir el álbum.', friendlyError(error), () => { state.identity = null; void applySession(session); });
  }
}

function setBusy(busy) {
  state.busy = busy;
  for (const node of [view.logout, view.pick, view.refresh, view.more, view.file, view.changePassword, view.mixButton]) if (node) node.disabled = busy || state.loading;
  document.querySelectorAll('.delete-photo, .edit-photo').forEach((node) => { node.disabled = busy || state.loading; });
}

const videosEnabled = () => photos?.schema !== 'v1';
const editable = () => photos?.schema === 'v2';

function showAlbum() {
  const page = element('div', 'album-page');
  const header = element('header', 'site-header');
  const headerContent = element('div', 'header-inner');
  const account = element('div', 'account');
  const avatar = element('span', 'avatar', state.user.email?.slice(0, 1).toUpperCase() || '♡');
  const accountText = element('span', 'account-email', state.user.email || 'Mi cuenta');
  const changePassword = button('Cambiar contraseña', 'lock', 'icon-button password-button');
  changePassword.title = 'Cambiar contraseña';
  changePassword.addEventListener('click', () => { state.recovery = true; showAuth('password'); });
  const logout = button('Salir', 'logout', 'button secondary compact');
  logout.addEventListener('click', () => void signOut());
  account.append(avatar, accountText, changePassword, logout);
  headerContent.append(brand(), account);
  header.append(headerContent);
  const main = element('main', 'album-main');
  main.id = 'main';
  const hero = element('section', 'album-hero');
  const intro = element('div', 'hero-intro');
  const badge = element('p', 'eyebrow hero-badge');
  badge.append(icon('heart'), document.createTextNode('NUESTRA HISTORIA, FOTO A FOTO'));
  intro.append(badge);
  const heading = element('h1');
  heading.innerHTML = 'Momentos que<br /><em>queremos guardar.</em>';
  intro.append(heading, element('p', 'hero-description', 'Un lugar para volver a los días bonitos. Y seguir sumando nuevos.'));
  const privacy = element('span', 'privacy-badge');
  privacy.append(icon('lock'), document.createTextNode('Álbum privado · Compartido entre nosotros'));
  intro.append(privacy);
  const upload = element('section', 'upload-zone');
  upload.setAttribute('aria-label', 'Subir fotografías y videos');
  const uploadIcon = element('div', 'upload-icon');
  uploadIcon.append(icon('upload'));
  const pick = button('Elegir fotos o videos', 'plus', 'button primary');
  const file = element('input', 'visually-hidden');
  file.type = 'file';
  file.multiple = true;
  file.accept = `${PHOTO_ACCEPT},${VIDEO_ACCEPT}`;
  file.id = 'photo-files';
  file.tabIndex = -1;
  file.setAttribute('aria-label', 'Seleccionar fotografías o videos para subir');
  const progress = element('p', 'upload-status', 'o arrástralos y suéltalos aquí');
  progress.setAttribute('role', 'status');
  const hint = element('p', 'file-hint', 'Fotos JPG, PNG o WebP hasta 10 MB · Videos MP4 (H.264) de hasta 15 s y 5 MB');
  const queue = element('ul', 'upload-queue');
  queue.setAttribute('aria-live', 'polite');
  const uploadPanel = createUploadPanel({
    onConfirm: (files, details) => void uploadFiles(files, details),
    onCancel: () => { progress.textContent = 'Selección cancelada. No se subió nada.'; },
  });
  upload.append(uploadIcon, element('h2', '', 'Un recuerdo más, juntos.'), element('p', 'muted', 'Los grandes momentos y los de todos los días.'), pick, file, progress, hint, uploadPanel.node, queue);
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { void stageFiles([...file.files]); file.value = ''; });
  for (const name of ['dragenter', 'dragover']) upload.addEventListener(name, (event) => { event.preventDefault(); if (!state.busy) upload.classList.add('drag-over'); });
  for (const name of ['dragleave', 'drop']) upload.addEventListener(name, (event) => { event.preventDefault(); upload.classList.remove('drag-over'); });
  upload.addEventListener('drop', (event) => { if (!state.busy) void stageFiles([...event.dataTransfer.files]); });
  hero.append(intro, upload);
  const collection = element('section', 'collection');
  const toolbar = element('div', 'gallery-toolbar');
  const title = element('div', 'collection-heading');
  const count = element('span', 'photo-count', '0');
  title.append(element('h2', '', 'Nuestros recuerdos'), count);
  const tools = element('div', 'toolbar-actions');
  const mix = mixButton(() => openMix());
  const refresh = button('Actualizar', 'refresh', 'button secondary compact');
  refresh.addEventListener('click', () => void loadPhotos());
  tools.append(mix, refresh);
  toolbar.append(title, tools);
  const filters = createFilters({ onChange: (next) => void applyFilters(next) });
  const gallery = element('div', 'gallery');
  const more = button('Ver más recuerdos', 'plus', 'button secondary load-more');
  more.hidden = true;
  more.addEventListener('click', () => { state.visible += PAGE_SIZE; void refreshVisible(); });
  collection.append(toolbar, filters.node, gallery, more);
  main.append(hero, collection);
  const footer = element('footer', 'site-footer');
  footer.append(element('span', '', 'Nuestro Álbum'), element('span', '', 'Lo nuestro, para siempre en un recuerdo. ♡'));
  page.append(header, main, footer);
  view = { page, logout, pick, file, hint, progress, queue, uploadPanel, gallery, refresh, more, count, changePassword, filters, mixButton: mix };
  createDialogs(page);
  mount(page);
  drawGallery();
}

function visibleRows() { return state.shown.slice(0, state.visible); }

function drawGallery() {
  if (!view.gallery) return;
  state.filters = reconcileFilters(state.photos, state.filters);
  state.shown = filterMemories(sortChronological(state.photos, 'desc'), state.filters);
  view.count.textContent = String(state.photos.length);
  view.more.hidden = state.shown.length <= state.visible;
  view.filters.update(state.photos, state.filters, state.shown.length, { videos: videosEnabled() });
  view.file.accept = videosEnabled() ? `${PHOTO_ACCEPT},${VIDEO_ACCEPT}` : PHOTO_ACCEPT;
  view.hint.textContent = videosEnabled() ? 'Fotos JPG, PNG o WebP hasta 10 MB · Videos MP4 (H.264) de hasta 15 s y 5 MB' : 'JPG, PNG o WebP · Hasta 10 MB por foto';
  renderGallery(view.gallery, visibleRows(), state.urls, {
    loading: state.loading,
    filtered: hasFilters(state.filters),
    editable: editable(),
    onOpen: openLightbox,
    onDelete: confirmDelete,
    onEdit: openDetails,
    onImageError: imageFallback,
    onClearFilters: () => void applyFilters({ ...EMPTY_FILTERS }),
  });
  setBusy(state.busy);
}

async function applyFilters(next) {
  state.filters = reconcileFilters(state.photos, next);
  state.visible = PAGE_SIZE;
  await refreshVisible();
}

// Firma solo las miniaturas visibles y vuelve a dibujar.
async function refreshVisible() {
  if (!view.gallery) return;
  const revision = state.revision;
  state.shown = filterMemories(sortChronological(state.photos, 'desc'), state.filters);
  try {
    const urls = await galleryUrls(visibleRows());
    if (revision !== state.revision) return;
    for (const [path, url] of urls) state.urls.set(path, url);
  } catch (error) { if (revision === state.revision) notify(friendlyError(error), 'error'); }
  if (revision === state.revision) drawGallery();
}

let loadingTask = null;

// Si ya hay una carga en curso, devuelve esa misma promesa para poder esperarla.
function loadPhotos() {
  if (state.loading) return loadingTask;
  if (state.busy || !view.gallery) return Promise.resolve();
  loadingTask = runLoad();
  return loadingTask;
}

async function runLoad() {
  const revision = state.revision;
  state.loading = true;
  setBusy(state.busy);
  view.gallery.setAttribute('aria-busy', 'true');
  // Sin recuerdos aún en pantalla, muestra «Buscando…» en vez del estado vacío.
  if (!state.photos.length) drawGallery();
  try {
    try { await auth.member(); }
    catch (error) {
      if (revision !== state.revision) return;
      clearPrivateState();
      view = {};
      showMessage('Comprueba tu acceso.', friendlyError(error), () => { state.identity = null; void auth.session().then((session) => applySession(session)).catch((e) => notify(friendlyError(e), 'error')); });
      return;
    }
    const rows = await photos.list();
    if (revision !== state.revision) return;
    state.photos = rows;
    state.filters = reconcileFilters(rows, state.filters);
    state.shown = filterMemories(sortChronological(rows, 'desc'), state.filters);
    const urls = await galleryUrls(visibleRows());
    if (revision !== state.revision) return;
    state.urls = urls;
  } catch (error) { if (revision === state.revision) notify(friendlyError(error), 'error'); }
  finally { if (revision === state.revision) { state.loading = false; drawGallery(); } }
}

async function galleryUrls(rows, extraPaths = []) {
  const urls = await storage.urls([...rows.map(cardPath), ...extraPaths]);
  // Respaldo seguro: una foto antigua cuya miniatura no existe usa su original privado.
  const missing = rows.filter((photo) => mediaType(photo) === 'photo' && photo.thumbnail_path && !urls.get(photo.thumbnail_path));
  if (missing.length) {
    const originals = await storage.urls(missing.map((photo) => photo.storage_path));
    for (const photo of missing) urls.set(photo.thumbnail_path, originals.get(photo.storage_path));
  }
  return urls;
}

function queueRow(name, text, className) {
  const row = element('li', className);
  const status = element('span', 'queue-status', text);
  row.append(element('span', 'queue-name', name), status);
  view.queue.append(row);
  return status;
}

// Valida la selección y muestra la vista previa. No se sube nada todavía.
async function stageFiles(files) {
  // La validación es local: se permite preparar la selección aunque el álbum siga cargando.
  if (state.busy || !files.length || !view.queue) return;
  if (files.length > MAX_FILES_PER_UPLOAD) { notify(`Selecciona hasta ${MAX_FILES_PER_UPLOAD} archivos a la vez.`, 'error'); return; }
  const revision = state.revision;
  view.queue.replaceChildren();
  view.uploadPanel.clear();
  const accepted = [];
  for (const file of files) {
    try {
      if (isVideoFile(file)) {
        if (!videosEnabled()) throw new AlbumError('Los videos estarán disponibles cuando se aplique la migración de Supabase.');
        view.progress.textContent = `Revisando ${file.name}…`;
        const { duration } = await validateVideo(file);
        accepted.push({ file, kind: 'video', duration });
      } else {
        await validateImageSignature(file);
        accepted.push({ file, kind: 'photo' });
      }
    } catch (error) { queueRow(file.name, friendlyError(error), 'queue-error'); }
    if (revision !== state.revision) return;
  }
  view.progress.textContent = accepted.length ? 'Revisa la vista previa y pulsa «Guardar en el álbum».' : 'Revisa los archivos e inténtalo de nuevo.';
  view.uploadPanel.show(accepted, { places: availablePlaces(state.photos), details: videosEnabled() });
}

async function uploadFiles(files, details) {
  if (state.busy || !files.length || !view.queue) return;
  const revision = state.revision;
  if (state.loading) {
    view.uploadPanel.setBusy(true);
    view.progress.textContent = 'Terminando de cargar el álbum…';
    await loadingTask;
    if (revision !== state.revision || !view.queue) return;
    view.uploadPanel.setBusy(false);
    if (state.busy) return;
  }
  const { progress, queue, uploadPanel } = view;
  queue.replaceChildren();
  setBusy(true);
  uploadPanel.setBusy(true);
  uploadPanel.setProgress(0);
  let completed = 0;
  let withoutThumbnail = 0;
  for (const [index, file] of files.entries()) {
    if (revision !== state.revision) break;
    const status = queueRow(file.name, 'En espera', '');
    const row = status.parentElement;
    let step = 0;
    try {
      const result = await photos.upload(file, (stage) => {
        if (revision !== state.revision) return;
        step++;
        progress.textContent = `${index + 1} de ${files.length} · ${stage}`;
        status.textContent = stage;
        uploadPanel.setProgress((index + Math.min(step, 5) / 5) / files.length);
      }, details);
      completed++;
      if (result.withoutThumbnail) withoutThumbnail++;
      status.textContent = 'Guardado';
      row.classList.add('queue-success');
    } catch (error) {
      status.textContent = friendlyError(error);
      row.classList.add('queue-error');
      // Las rutas de una compensación fallida se muestran solo en esta sesión autenticada.
      if (error.details && revision === state.revision) status.textContent += ` Referencia: ${error.details.id}. Archivos: ${error.details.paths.join(', ')}`;
    }
    uploadPanel.setProgress((index + 1) / files.length);
  }
  if (revision !== state.revision) return;
  uploadPanel.setBusy(false);
  uploadPanel.clear();
  setBusy(false);
  progress.textContent = completed ? `${completed} de ${files.length} recuerdos guardados.` : 'Revisa los archivos e inténtalo de nuevo.';
  if (completed) notify(`${completed === 1 ? 'Recuerdo guardado' : `${completed} recuerdos guardados`}.${withoutThumbnail ? ' Algunos usarán el original como vista previa.' : ' Ya forman parte de nuestra historia.'}`);
  await loadPhotos();
}

function createDialogs(page) {
  const lightbox = element('dialog', 'lightbox');
  lightbox.setAttribute('aria-label', 'Fotografía ampliada');
  const close = button('Cerrar vista ampliada', 'close', 'icon-button lightbox-close');
  close.addEventListener('click', () => lightbox.close());
  const previous = button('Fotografía anterior', 'chevron', 'icon-button lightbox-nav previous');
  const next = button('Fotografía siguiente', 'chevron', 'icon-button lightbox-nav next');
  previous.addEventListener('click', () => void openLightbox(state.lightboxIndex - 1));
  next.addEventListener('click', () => void openLightbox(state.lightboxIndex + 1));
  const stage = element('div', 'lightbox-stage');
  const preview = element('img', 'lightbox-preview');
  preview.alt = '';
  preview.setAttribute('aria-hidden', 'true');
  preview.referrerPolicy = 'no-referrer';
  const image = element('img', 'lightbox-image');
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  const video = element('video', 'lightbox-video');
  Object.assign(video, { controls: true, playsInline: true, preload: 'none' });
  video.hidden = true;
  const status = element('p', 'lightbox-status', 'Cargando…');
  status.setAttribute('role', 'status');
  stage.append(preview, image, video, status);
  const caption = element('div', 'lightbox-caption');
  caption.tabIndex = 0;
  caption.setAttribute('role', 'region');
  caption.setAttribute('aria-label', 'Nombre y fecha del recuerdo');
  const name = element('h2');
  const date = element('p');
  const edit = button('Editar fecha y lugar', 'pencil', 'text-button lightbox-edit');
  edit.addEventListener('click', () => { const photo = state.shown[state.lightboxIndex]; if (photo) openDetails(photo); });
  caption.append(name, date, edit);
  lightbox.append(close, previous, stage, next, caption);
  lightbox.addEventListener('close', () => {
    state.lightboxIndex = -1;
    image.removeAttribute('src');
    preview.removeAttribute('src');
    unloadVideo(video);
  });
  lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });
  lightbox.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'VIDEO') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); if (state.lightboxIndex > 0) void openLightbox(state.lightboxIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); if (state.lightboxIndex < state.shown.length - 1) void openLightbox(state.lightboxIndex + 1); }
  });
  const confirm = element('dialog', 'confirm-dialog');
  confirm.setAttribute('aria-labelledby', 'delete-heading');
  confirm.setAttribute('aria-describedby', 'delete-description');
  const heading = element('h2', '', '¿Eliminar este recuerdo?');
  heading.id = 'delete-heading';
  const description = element('p', 'muted', 'Se eliminarán el archivo original y sus versiones optimizadas para los dos. Esta acción no se puede deshacer.');
  description.id = 'delete-description';
  const filename = element('p', 'confirm-filename');
  const cancel = button('Conservar recuerdo', null, 'button secondary');
  cancel.autofocus = true;
  cancel.addEventListener('click', () => confirm.close());
  const remove = button('Sí, eliminar', 'trash', 'button danger');
  const actions = element('div', 'dialog-actions');
  actions.append(cancel, remove);
  const deleteStatus = element('p', 'form-status');
  deleteStatus.setAttribute('role', 'status');
  confirm.append(icon('trash'), heading, description, filename, deleteStatus, actions);
  confirm.addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });
  const details = createDetailsDialog({ onSave: saveDetails });
  const mix = createMix({ sign: (paths) => storage.urls(paths) });
  page.append(lightbox, confirm, details.dialog, mix.dialog);
  Object.assign(view, { lightbox, lightboxImage: image, lightboxPreview: preview, lightboxVideo: video, lightboxStatus: status, lightboxName: name, lightboxDate: date, lightboxEdit: edit, previous, next, confirm, confirmFilename: filename, deleteStatus, cancelDelete: cancel, remove, details, mix });
}

function unloadVideo(video) {
  video.pause();
  video.removeAttribute('src');
  video.removeAttribute('poster');
  video.load();
  video.hidden = true;
}

function describe(photo, index) {
  const place = normalizePlace(photo.place);
  return `${formatMemoryDate(photo)}${place ? ` · ${place}` : ''} · ${index + 1} de ${state.shown.length}`;
}

async function openLightbox(index) {
  const photo = state.shown[index];
  if (!photo || !view.lightbox) return;
  const revision = state.revision;
  state.lightboxIndex = index;
  const { lightboxImage: image, lightboxPreview: preview, lightboxVideo: video, lightboxStatus: status } = view;
  const isVideo = mediaType(photo) === 'video';
  const current = () => revision === state.revision && state.lightboxIndex === index && state.shown[index]?.id === photo.id;
  image.hidden = true;
  image.removeAttribute('src');
  image.alt = photo.original_name;
  preview.hidden = true;
  preview.removeAttribute('src');
  unloadVideo(video);
  status.hidden = false;
  status.textContent = isVideo ? 'Cargando el video…' : 'Cargando la fotografía…';
  view.lightbox.setAttribute('aria-label', isVideo ? 'Video ampliado' : 'Fotografía ampliada');
  view.lightboxName.textContent = photo.original_name;
  view.lightboxDate.textContent = describe(photo, index);
  view.lightboxEdit.hidden = !editable();
  view.previous.disabled = index === 0;
  view.next.disabled = index === state.shown.length - 1;
  if (!view.lightbox.open) view.lightbox.showModal();
  if (isVideo) {
    video.hidden = false;
    video.setAttribute('aria-label', photo.original_name);
    video.onloadedmetadata = () => { if (current()) status.hidden = true; };
    video.onerror = () => void recoverVideo(photo, video, status, current);
    try {
      // El video se firma y se carga solo ahora, cuando la persona lo abre. Nunca se reproduce solo.
      const urls = await storage.urls([photo.storage_path, photo.thumbnail_path].filter(Boolean));
      if (!current()) return;
      if (photo.thumbnail_path && urls.get(photo.thumbnail_path)) video.poster = urls.get(photo.thumbnail_path);
      const url = urls.get(photo.storage_path);
      if (!url) throw new Error('Video no disponible');
      video.preload = 'metadata';
      video.src = url;
    } catch { if (current()) status.textContent = 'No se pudo abrir el video. Actualiza el álbum para volver a intentar.'; }
    return;
  }
  // Carga progresiva: miniatura ya firmada como fondo y luego la versión de visualización.
  const thumbUrl = state.urls.get(cardPath(photo));
  if (thumbUrl) { preview.src = thumbUrl; preview.hidden = false; }
  image.onload = () => { if (!current()) return; image.hidden = false; preview.hidden = true; status.hidden = true; };
  image.onerror = () => { if (!current()) return; image.hidden = true; status.hidden = false; status.textContent = 'No se pudo abrir la fotografía. Cierra y vuelve a intentar o actualiza el álbum.'; };
  try {
    const path = photo.display_path || photo.storage_path;
    const urls = await storage.urls([path]);
    if (!current()) return;
    const url = urls.get(path);
    if (!url) throw new Error('Fotografía no disponible');
    image.src = url;
  } catch { if (current()) status.textContent = 'No se pudo abrir la fotografía. Actualiza el álbum para volver a intentar.'; }
}

// Una URL firmada vencida a mitad de reproducción se renueva una vez y conserva la posición.
async function recoverVideo(photo, video, status, current) {
  if (!current() || video.dataset.retried || !video.getAttribute('src')) { if (current()) { status.hidden = false; status.textContent = 'No se pudo reproducir el video.'; } return; }
  video.dataset.retried = 'true';
  const position = video.currentTime;
  try {
    const url = (await storage.urls([photo.storage_path], { force: true })).get(photo.storage_path);
    if (!current() || !url) return;
    video.src = url;
    video.currentTime = position;
  } catch { if (current()) { status.hidden = false; status.textContent = 'No se pudo reproducir el video.'; } }
}

function confirmDelete(photo) {
  if (state.busy || state.loading) return;
  const { confirm, remove, cancelDelete, deleteStatus } = view;
  view.confirmFilename.textContent = photo.original_name;
  deleteStatus.textContent = '';
  remove.disabled = false;
  cancelDelete.disabled = false;
  remove.onclick = async () => {
    const revision = state.revision;
    remove.disabled = true;
    cancelDelete.disabled = true;
    deleteStatus.textContent = 'Eliminando el recuerdo y sus versiones…';
    setBusy(true);
    try {
      await photos.remove(photo.id);
      if (revision !== state.revision) return;
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      confirm.close();
      notify('Recuerdo eliminado del álbum compartido.');
    } catch (error) { if (revision === state.revision) deleteStatus.textContent = friendlyError(error); }
    finally {
      if (revision === state.revision) {
        setBusy(false);
        remove.disabled = false;
        cancelDelete.disabled = false;
        drawGallery();
        if (confirm.open) cancelDelete.focus(); else view.refresh.focus();
        // Firma la miniatura de la tarjeta que pueda entrar en la tanda visible.
        void refreshVisible();
      }
    }
  };
  confirm.showModal();
}

function openDetails(photo) {
  if (state.busy || state.loading || !editable()) return;
  view.details.open(photo, availablePlaces(state.photos));
}

async function saveDetails(photo, details) {
  const revision = state.revision;
  let updated;
  try { updated = await photos.updateDetails(photo.id, details); }
  catch (error) { throw new Error(friendlyError(error)); }
  if (revision !== state.revision) return;
  state.photos = state.photos.map((item) => (item.id === updated.id ? updated : item));
  const lightboxPhoto = view.lightbox?.open ? state.shown[state.lightboxIndex] : null;
  await refreshVisible();
  if (lightboxPhoto?.id === updated.id) {
    const index = state.shown.findIndex((item) => item.id === updated.id);
    if (index === -1) view.lightbox.close();
    else { state.lightboxIndex = index; view.lightboxDate.textContent = describe(updated, index); }
  }
  notify('Recuerdo actualizado.');
}

function openMix() {
  if (state.busy || state.loading || !view.mix) return;
  if (!view.mix.open(state.shown)) {
    notify(hasFilters(state.filters)
      ? 'Con estos filtros hay menos de dos recuerdos. Elige otro mes o muestra todos para crear el mix.'
      : 'Aún no hay suficientes recuerdos para un mix. Sube al menos dos fotos o videos.', 'info');
  }
}

async function imageFallback(photo, image, placeholder) {
  image.hidden = true;
  placeholder.hidden = false;
  if (image.dataset.retried || mediaType(photo) === 'video') return;
  image.dataset.retried = 'true';
  const revision = state.revision;
  try {
    const urls = await storage.urls([photo.storage_path], { force: true });
    if (revision !== state.revision || !image.isConnected) return;
    const url = urls.get(photo.storage_path);
    if (url) image.src = url;
  } catch { /* La tarjeta conserva el botón para reintentar en la vista ampliada. */ }
}

async function renewImages() {
  if (!state.user || !view.gallery || document.hidden || signing || state.loading) return;
  signing = true;
  const revision = state.revision;
  try {
    const current = state.lightboxIndex >= 0 ? state.shown[state.lightboxIndex] : null;
    const currentPath = current && mediaType(current) === 'photo' ? current.display_path || current.storage_path : null;
    const urls = await galleryUrls(visibleRows(), currentPath ? [currentPath] : []);
    if (revision !== state.revision) return;
    for (const [path, url] of urls) state.urls.set(path, url);
    for (const image of view.gallery.querySelectorAll('img[data-photo-id]')) {
      const photo = state.photos.find((item) => item.id === image.dataset.photoId);
      const url = photo && urls.get(cardPath(photo));
      if (url && image.src !== url) { delete image.dataset.retried; image.src = url; }
    }
    if (currentPath && view.lightbox.open && state.shown[state.lightboxIndex]?.id === current.id) {
      const url = urls.get(currentPath);
      if (url && view.lightboxImage.src !== url) view.lightboxImage.src = url;
    }
  } catch { /* Recupera en el siguiente intervalo o con Actualizar; no genera avisos repetidos sin conexión. */ }
  finally { signing = false; }
}

if (!config.ready) {
  showMessage('Preparemos nuestro álbum.', `${config.message} Encontrarás los pasos en README.md. No necesitas introducir contraseñas ni claves administrativas.`);
} else {
  auth = createAuthService(supabase);
  storage = createStorageService(supabase);
  photos = createPhotoService(supabase, storage);
  // El callback permanece síncrono: las operaciones de Auth se ejecutan después de liberar su bloqueo.
  supabase.auth.onAuthStateChange((event, session) => { setTimeout(() => void applySession(session, event), 0); });
  try { await applySession(await auth.session()); }
  catch (error) { showAuth(); notify(friendlyError(error), 'error'); }
  setInterval(() => void renewImages(), 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void renewImages(); });
  window.addEventListener('online', () => void renewImages());
  window.addEventListener('focus', () => void renewImages());
}

window.addEventListener('beforeunload', (event) => { if (state.busy) { event.preventDefault(); event.returnValue = ''; } });
