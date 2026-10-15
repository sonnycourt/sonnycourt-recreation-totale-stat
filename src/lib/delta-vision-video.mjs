// Prepare Bunny behind the still poster; reveal on playback, without a fade.
let library;
function loadLibrary(doc, win) {
  if (win.playerjs?.Player) return Promise.resolve(win.playerjs);
  if (library) return library;
  library = new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    const fail = () => { win.clearTimeout(timer); library = null; reject(new Error('Player API unavailable')); };
    const timer = win.setTimeout(fail, 8000);
    script.src = 'https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js';
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      if (!win.playerjs?.Player) return fail();
      win.clearTimeout(timer);
      resolve(win.playerjs);
    };
    doc.head.append(script);
  });
  return library;
}
async function connect(frame) {
  const win = frame.ownerDocument.defaultView;
  const playerjs = await loadLibrary(frame.ownerDocument, win);
  return new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => reject(new Error('Player ready timeout')), 8000);
    const player = new playerjs.Player(frame);
    player.on('ready', () => { win.clearTimeout(timer); resolve(player); });
  });
}
export function initDeltaVideo(root, connectPlayer = connect) {
  const button = root.querySelector('[data-video-play]');
  if (!button || !root.dataset.videoUrl) return;
  const doc = root.ownerDocument, win = doc.defaultView;
  const stage = root.closest('[data-jungle-stage]');
  const poster = root.querySelector('.video-thumbnail');
  const frame = doc.createElement('iframe');
  const url = new URL(root.dataset.videoUrl);
  url.searchParams.set('autoplay', 'false');
  url.searchParams.set('preload', 'true');
  url.searchParams.set('rememberPosition', 'false');
  url.searchParams.set('rememberSettings', 'false');
  url.searchParams.set('t', '0');
  frame.src = url.href;
  frame.title = 'Présentation de la méthode Delta Vision';
  frame.allow = 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.loading = 'eager';
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { opacity: '0', pointerEvents: 'none', transition: 'none' });
  let api, requested = false, revealed = false, loaded = false, failed = false, fallbackTimer;
  root.dataset.videoState = 'preloading';
  const reveal = () => {
    if (!requested || revealed) return;
    revealed = true;
    win.clearTimeout(fallbackTimer);
    // One atomic visual switch: no thumbnail transform, no fade, no foliage warp.
    stage?.classList.add('is-open');
    if (stage) stage.dataset.openingComplete = 'true';
    poster?.remove();
    button.remove();
    frame.style.opacity = '1';
    frame.style.pointerEvents = 'auto';
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    root.dataset.videoState = 'visible';
    frame.focus({ preventScroll: true });
  };
  const start = () => {
    if (!requested || !api || revealed) return;
    try { api.play(); } catch { reveal(); return; }
    // If autoplay is rejected, expose the already loaded native Play control.
    fallbackTimer = win.setTimeout(reveal, 1800);
  };
  frame.addEventListener('load', () => {
    loaded = true;
    if (requested && failed) reveal();
  }, { once: true });
  root.append(frame);
  connectPlayer(frame).then(player => {
    api = player;
    if (!requested) root.dataset.videoState = 'prepared';
    api.on('play', () => {
      if (!requested || revealed) return;
      win.requestAnimationFrame(reveal);
    });
    start();
  }).catch(() => {
    failed = true;
    if (requested && loaded) reveal();
  });
  button.addEventListener('click', () => {
    if (requested) return;
    requested = true;
    root.dataset.videoState = 'starting';
    button.setAttribute('aria-label', 'Chargement de la vidéo');
    button.setAttribute('aria-busy', 'true');
    if (failed && loaded) reveal();
    else start();
    // A blocked iframe must never leave the visitor behind a dead overlay.
    win.setTimeout(() => { if (!revealed) reveal(); }, 10000);
  });
}
