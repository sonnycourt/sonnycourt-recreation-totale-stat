import { mountMc2BunnyVideo } from './mc2-bunny-player.mjs';

export function initSpecialVideo(root, source) {
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const original = root.querySelector('iframe');
  const nativeUrl = original.src;
  const poster = root.querySelector('[data-vsl-play]');
  const controls = root.querySelector('[data-vsl-controls]');
  const toggle = root.querySelector('[data-vsl-toggle]');
  const seek = root.querySelector('[data-vsl-seek]');
  const time = root.querySelector('[data-vsl-time]');
  const mute = root.querySelector('[data-vsl-mute]');
  const fullscreen = root.querySelector('[data-vsl-fullscreen]');
  const fallback = root.querySelector('[data-vsl-native]');
  const status = root.querySelector('[data-vsl-status]');
  const video = mountMc2BunnyVideo(original);
  video.className = 'special-vsl__engine';
  poster.hidden = false;
  fallback.hidden = false;
  let busy = false;
  const format = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
  function sync() {
    toggle.dataset.paused = String(video.paused);
    toggle.setAttribute('aria-label', video.paused ? 'Lire la vidéo' : 'Mettre en pause');
    mute.setAttribute('aria-label', video.muted ? 'Activer le son' : 'Couper le son');
    mute.setAttribute('aria-pressed', String(video.muted));
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    seek.disabled = !duration;
    seek.max = String(duration || 1);
    seek.value = String(video.currentTime);
    time.textContent = `${format(video.currentTime)} / ${format(duration)}`;
  }
  async function playPause() {
    if (busy) return;
    if (!video.paused) { video.pause(); sync(); return; }
    busy = true;
    status.textContent = 'Chargement…';
    try { await video.play(); status.textContent = ''; }
    catch { status.textContent = 'Réessaie ou utilise le lecteur standard.'; }
    finally { busy = false; sync(); }
  }
  poster.addEventListener('click', playPause);
  toggle.addEventListener('click', playPause);
  seek.addEventListener('input', () => { video.currentTime = Number(seek.value); });
  mute.addEventListener('click', () => { video.muted = !video.muted; sync(); });
  fullscreen.hidden = !root.requestFullscreen;
  fullscreen.addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.requestFullscreen(); }
    catch { status.textContent = 'Le plein écran reste disponible dans le lecteur standard.'; }
  });
  fallback.addEventListener('click', () => {
    const position = video.currentTime;
    video.destroy();
    const frame = document.createElement('iframe');
    const url = new URL(nativeUrl);
    url.searchParams.set('t', String(position));
    frame.src = url.href;
    frame.title = 'Présentation d’Esprit Subconscient 2.0';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    video.replaceWith(frame);
    poster.hidden = controls.hidden = fallback.hidden = true;
    status.textContent = '';
  });
  video.addEventListener('playing', () => { poster.hidden = true; controls.hidden = false; status.textContent = ''; sync(); });
  for (const event of ['loadedmetadata', 'timeupdate', 'pause', 'ended', 'volumechange']) video.addEventListener(event, sync);
  video.addEventListener('bunnyerror', () => { status.textContent = 'Réessaie ou utilise le lecteur standard.'; });
  video.loadSource(source, { startAt: 0 });
  sync();
}
