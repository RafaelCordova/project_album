import { config, supabase } from './config/supabase.js';
import { themeFor } from './config/userThemes.js';
import { createAuthService } from './services/authService.js';
import { createStorageService } from './services/storageService.js';
import { createPhotoService, PAGE_SIZE } from './services/photoService.js';
import { validateFile } from './services/imageService.js';
import { friendlyError } from './utils/errors.js';
import { authView } from './components/authView.js';
import { renderGallery } from './components/gallery.js';
import { brand, button, element, formatDate, icon, notify } from './components/ui.js';

const app = document.querySelector('#app');
const recoveryFromUrl = new URLSearchParams(location.search).get('recovery') === '1' || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
const state = { user: null, identity: null, revision: 0, photos: [], urls: new Map(), more: false, loading: false, busy: false, recovery: recoveryFromUrl, lightboxIndex: -1 };
let view = {};
let auth;
let storage;
let photos;
let signing = false;

function mount(node) { app.replaceChildren(node); app.setAttribute('aria-busy', 'false'); }
function cleanAuthUrl() { if (location.hash || location.search) history.replaceState(null, '', location.pathname); }
function clearPrivateState() {
  state.revision++;
  state.user = null;
  state.photos = [];
  state.urls.clear();
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
  ui.alternate.addEventListener('click', () => mode === 'password' ? void signOut() : showAuth(mode === 'login' ? 'recover' : 'login'));
  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ui.form.reportValidity()) return;
    const data = new FormData(ui.form);
    if (mode === 'password' && data.get('password') !== data.get('confirm')) {
      ui.status.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    ui.submit.disabled = true;
    ui.form.setAttribute('aria-busy', 'true');
    ui.status.textContent = mode === 'login' ? 'Abriendo el álbum…' : 'Un momento…';
    try {
      if (mode === 'login') {
        await auth.signIn(data.get('email'), data.get('password'));
        ui.form.reset();
      } else if (mode === 'recover') {
        await auth.recover(data.get('email'));
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
    finally { ui.submit.disabled = false; ui.form.setAttribute('aria-busy', 'false'); }
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
  for (const node of [view.logout, view.pick, view.refresh, view.more, view.file, view.changePassword]) if (node) node.disabled = busy || state.loading;
  document.querySelectorAll('.delete-photo').forEach((node) => { node.disabled = busy || state.loading; });
}

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
  upload.setAttribute('aria-label', 'Subir fotografías');
  const uploadIcon = element('div', 'upload-icon');
  uploadIcon.append(icon('upload'));
  const pick = button('Elegir fotografías', 'plus', 'button primary');
  const file = element('input', 'visually-hidden');
  file.type = 'file';
  file.multiple = true;
  file.accept = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
  file.id = 'photo-files';
  file.tabIndex = -1;
  file.setAttribute('aria-label', 'Seleccionar fotografías para subir');
  const progress = element('p', 'upload-status', 'o arrástralas y suéltalas aquí');
  progress.setAttribute('role', 'status');
  const queue = element('ul', 'upload-queue');
  queue.setAttribute('aria-live', 'polite');
  upload.append(uploadIcon, element('h2', '', 'Un recuerdo más, juntos.'), element('p', 'muted', 'Los grandes momentos y los de todos los días.'), pick, file, progress, element('p', 'file-hint', 'JPG, PNG o WebP · Hasta 10 MB por foto'), queue);
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { void uploadFiles([...file.files]); file.value = ''; });
  for (const name of ['dragenter', 'dragover']) upload.addEventListener(name, (event) => { event.preventDefault(); if (!state.busy) upload.classList.add('drag-over'); });
  for (const name of ['dragleave', 'drop']) upload.addEventListener(name, (event) => { event.preventDefault(); upload.classList.remove('drag-over'); });
  upload.addEventListener('drop', (event) => { if (!state.busy) void uploadFiles([...event.dataTransfer.files]); });
  hero.append(intro, upload);
  const collection = element('section', 'collection');
  const toolbar = element('div', 'gallery-toolbar');
  const title = element('div', 'collection-heading');
  const count = element('span', 'photo-count', '0');
  title.append(element('h2', '', 'Nuestros recuerdos'), count);
  const refresh = button('Actualizar', 'refresh', 'button secondary compact');
  refresh.addEventListener('click', () => void loadPhotos());
  toolbar.append(title, refresh);
  const gallery = element('div', 'gallery');
  const more = button('Ver más recuerdos', 'plus', 'button secondary load-more');
  more.hidden = true;
  more.addEventListener('click', () => void loadPhotos(true));
  collection.append(toolbar, gallery, more);
  main.append(hero, collection);
  const footer = element('footer', 'site-footer');
  footer.append(element('span', '', 'Nuestro Álbum'), element('span', '', 'Lo nuestro, para siempre en un recuerdo. ♡'));
  page.append(header, main, footer);
  view = { page, logout, pick, file, progress, queue, gallery, refresh, more, count, changePassword };
  createDialogs(page);
  mount(page);
  drawGallery();
}

function drawGallery() {
  if (!view.gallery) return;
  view.count.textContent = `${state.photos.length}${state.more ? '+' : ''}`;
  view.more.hidden = !state.more;
  renderGallery(view.gallery, state.photos, state.urls, { loading: state.loading, onOpen: openLightbox, onDelete: confirmDelete, onImageError: imageFallback });
  setBusy(state.busy);
}

async function loadPhotos(append = false) {
  if (state.loading || state.busy || !view.gallery) return;
  const revision = state.revision;
  state.loading = true;
  setBusy(state.busy);
  view.gallery.setAttribute('aria-busy', 'true');
  try {
    try { await auth.member(); }
    catch (error) {
      if (revision !== state.revision) return;
      clearPrivateState();
      view = {};
      showMessage('Comprueba tu acceso.', friendlyError(error), () => { state.identity = null; void auth.session().then((session) => applySession(session)).catch((e) => notify(friendlyError(e), 'error')); });
      return;
    }
    const rows = await photos.list(append ? state.photos.length : 0);
    if (revision !== state.revision) return;
    state.photos = append ? [...new Map([...state.photos, ...rows].map((photo) => [photo.id, photo])).values()] : rows;
    state.more = rows.length === PAGE_SIZE;
    const urls = await galleryUrls(state.photos);
    if (revision !== state.revision) return;
    state.urls = urls;
  } catch (error) { if (revision === state.revision) notify(friendlyError(error), 'error'); }
  finally { if (revision === state.revision) { state.loading = false; drawGallery(); } }
}

async function galleryUrls(rows, extraPaths = []) {
  const urls = await storage.urls([...rows.map((photo) => photo.thumbnail_path || photo.storage_path), ...extraPaths]);
  const missing = rows.filter((photo) => photo.thumbnail_path && !urls.get(photo.thumbnail_path));
  if (missing.length) {
    const originals = await storage.urls(missing.map((photo) => photo.storage_path));
    for (const photo of missing) urls.set(photo.thumbnail_path, originals.get(photo.storage_path));
  }
  return urls;
}

async function uploadFiles(files) {
  if (state.busy || state.loading || !files.length || !view.queue) return;
  if (files.length > 10) { notify('Selecciona hasta 10 fotografías a la vez.', 'error'); return; }
  const revision = state.revision;
  const progress = view.progress;
  const queue = view.queue;
  queue.replaceChildren();
  setBusy(true);
  let completed = 0;
  let withoutThumbnail = 0;
  for (const [index, file] of files.entries()) {
    if (revision !== state.revision) break;
    const row = element('li');
    const name = element('span', 'queue-name', file.name);
    const status = element('span', 'queue-status', 'En espera');
    row.append(name, status);
    queue.append(row);
    try {
      validateFile(file);
      const result = await photos.upload(file, (stage) => { if (revision === state.revision) { progress.textContent = `${index + 1} de ${files.length} · ${stage}`; status.textContent = stage; } });
      completed++;
      if (result.withoutThumbnail) withoutThumbnail++;
      status.textContent = 'Guardada';
      row.classList.add('queue-success');
    } catch (error) {
      status.textContent = friendlyError(error);
      row.classList.add('queue-error');
      // Las rutas de una compensación fallida se muestran solo en esta sesión autenticada.
      if (error.details && revision === state.revision) status.textContent += ` Referencia: ${error.details.id}. Archivos: ${error.details.paths.join(', ')}`;
    }
  }
  if (revision !== state.revision) return;
  setBusy(false);
  progress.textContent = completed ? `${completed} de ${files.length} recuerdos guardados.` : 'Revisa los archivos e inténtalo de nuevo.';
  if (completed) notify(`${completed === 1 ? 'Recuerdo guardado' : `${completed} recuerdos guardados`}.${withoutThumbnail ? ' Algunas fotos usarán el original como vista previa.' : ' Ya forman parte de nuestra historia.'}`);
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
  const image = element('img', 'lightbox-image');
  image.referrerPolicy = 'no-referrer';
  const status = element('p', 'lightbox-status', 'Abriendo el original…');
  status.setAttribute('role', 'status');
  stage.append(image, status);
  const caption = element('div', 'lightbox-caption');
  caption.tabIndex = 0;
  caption.setAttribute('role', 'region');
  caption.setAttribute('aria-label', 'Nombre y fecha del recuerdo');
  const name = element('h2');
  const date = element('p');
  caption.append(name, date);
  lightbox.append(close, previous, stage, next, caption);
  lightbox.addEventListener('close', () => { state.lightboxIndex = -1; image.removeAttribute('src'); });
  lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });
  lightbox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); if (state.lightboxIndex > 0) void openLightbox(state.lightboxIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); if (state.lightboxIndex < state.photos.length - 1) void openLightbox(state.lightboxIndex + 1); }
  });
  const confirm = element('dialog', 'confirm-dialog');
  confirm.setAttribute('aria-labelledby', 'delete-heading');
  confirm.setAttribute('aria-describedby', 'delete-description');
  const heading = element('h2', '', '¿Eliminar este recuerdo?');
  heading.id = 'delete-heading';
  const description = element('p', 'muted', 'Se eliminarán el original y su miniatura para los dos. Esta acción no se puede deshacer.');
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
  page.append(lightbox, confirm);
  Object.assign(view, { lightbox, lightboxImage: image, lightboxStatus: status, lightboxName: name, lightboxDate: date, previous, next, confirm, confirmFilename: filename, deleteStatus, cancelDelete: cancel, remove });
}

async function openLightbox(index) {
  const photo = state.photos[index];
  if (!photo || !view.lightbox) return;
  const revision = state.revision;
  state.lightboxIndex = index;
  const image = view.lightboxImage;
  const status = view.lightboxStatus;
  image.hidden = true;
  image.removeAttribute('src');
  image.alt = photo.original_name;
  status.hidden = false;
  status.textContent = 'Abriendo el original…';
  view.lightboxName.textContent = photo.original_name;
  view.lightboxDate.textContent = `Subida: ${formatDate(photo.created_at)} · ${index + 1} de ${state.photos.length}`;
  view.previous.disabled = index === 0;
  view.next.disabled = index === state.photos.length - 1;
  image.onload = () => { image.hidden = false; status.hidden = true; };
  image.onerror = () => { image.hidden = true; status.hidden = false; status.textContent = 'No se pudo abrir el original. Cierra y vuelve a intentar o actualiza el álbum.'; };
  if (!view.lightbox.open) view.lightbox.showModal();
  try {
    const urls = await storage.urls([photo.storage_path]);
    if (revision !== state.revision || state.lightboxIndex !== index) return;
    const url = urls.get(photo.storage_path);
    if (!url) throw new Error('Original no disponible');
    image.src = url;
  } catch (error) { if (revision === state.revision && state.lightboxIndex === index) status.textContent = 'No se pudo abrir el original. Actualiza el álbum para volver a intentar.'; }
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
    deleteStatus.textContent = 'Eliminando original y miniatura…';
    setBusy(true);
    try {
      await photos.remove(photo.id);
      if (revision !== state.revision) return;
      state.photos = state.photos.filter((item) => item.id !== photo.id);
      confirm.close();
      notify('Recuerdo eliminado del álbum compartido.');
    } catch (error) { if (revision === state.revision) deleteStatus.textContent = friendlyError(error); }
    finally { if (revision === state.revision) { setBusy(false); remove.disabled = false; cancelDelete.disabled = false; drawGallery(); if (confirm.open) cancelDelete.focus(); else view.refresh.focus(); } }
  };
  confirm.showModal();
}

async function imageFallback(photo, image, placeholder) {
  image.hidden = true;
  placeholder.hidden = false;
  if (image.dataset.retried) return;
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
    const current = state.photos[state.lightboxIndex];
    const urls = await galleryUrls(state.photos, current ? [current.storage_path] : []);
    if (revision !== state.revision) return;
    state.urls = urls;
    for (const image of view.gallery.querySelectorAll('img[data-photo-id]')) {
      const photo = state.photos.find((item) => item.id === image.dataset.photoId);
      const url = urls.get(photo.thumbnail_path || photo.storage_path);
      if (url && image.src !== url) { delete image.dataset.retried; image.src = url; }
    }
    if (current && view.lightbox.open && state.photos[state.lightboxIndex]?.id === current.id) {
      const url = urls.get(current.storage_path);
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
