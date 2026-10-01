// Playback belongs exclusively to Bunny's official iframe. This adapter only
// translates the documented Player.js API for the existing MC2 page controls.
// No HLS attachment, decoder recovery, buffering watchdog, or clock correction.
const PLAYER_ORIGIN = 'https://player.mediadelivery.net';
const PLAYER_JS = 'https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js';
export const MC2_BUNNY_UI_VERSION = 1;
export const MC2_BUNNY_LIBRARY = '698588';

// Validated official player by default; keep an explicit diagnostic fallback.
export function useMc2BunnyPlayer(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('player') !== 'legacy';
}

export function bunnyVideoId(source) {
  const value = String(source || '');
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (uuid.test(value)) return value;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'vz-601d6eb4-a9a.b-cdn.net') {
    throw new Error('Source vidéo MC2 non reconnue');
  }
  const id = url.pathname.split('/')[1];
  if (!uuid.test(id)) throw new Error('Identifiant vidéo MC2 non reconnu');
  return id;
}

export function bunnyEmbedUrl(source, startAt = 0) {
  const url = new URL(`/embed/${MC2_BUNNY_LIBRARY}/${bunnyVideoId(source)}`, PLAYER_ORIGIN);
  for (const [key, value] of Object.entries({
    autoplay: false, preload: true, muted: false, playsinline: true,
    rememberPosition: false, rememberSettings: false, showSpeed: false,
    chromecast: false, disableAirPlay: true, levelCap: true,
    mc2ui: String(MC2_BUNNY_UI_VERSION), t: Math.max(0, Number(startAt) || 0),
  })) url.searchParams.set(key, String(value));
  return url.href;
}

let playerJsPromise;
function loadPlayerJs(doc, win) {
  if (win.playerjs?.Player) return Promise.resolve(win.playerjs);
  if (playerJsPromise) return playerJsPromise;
  playerJsPromise = new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = PLAYER_JS;
    script.async = true;
    const timer = win.setTimeout(() => fail(), 12000);
    function fail() {
      win.clearTimeout(timer);
      script.remove();
      playerJsPromise = null;
      reject(new Error('Le lecteur Bunny ne répond pas. Réessaie.'));
    }
    script.onerror = fail;
    script.onload = () => {
      win.clearTimeout(timer);
      if (!win.playerjs?.Player) return fail();
      resolve(win.playerjs);
    };
    doc.head.append(script);
  });
  return playerJsPromise;
}

export function mountMc2BunnyVideo(element, { fallbackDuration = 0, loadApi = loadPlayerJs } = {}) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const host = doc.createElement('div');
  for (const attr of element.attributes) host.setAttribute(attr.name, attr.value);
  host.removeAttribute('oncontextmenu');
  host.dataset.playerEngine = 'bunny';
  host.style.position = 'relative';
  element.replaceWith(host);
  let frame, cover, api, source = '', generation = 0, destroyed = false;
  let apiReady = false, uiReady = false, metadataReady = false;
  let time = 0, duration = Number(fallbackDuration) || 0, paused = true, ended = false;
  let volume = 0.8, muted = false, wantedPlay = false, seekTarget = null;
  let seekRevision = 0, seekRequestedAt = 0;
  let startupTimer, playTimer, positionTimer, playWaiters = [];
  const diagnostics = { engine: 'bunny', attachments: 0, commands: [], errors: [], uiVersion: null };
  const emit = (type, detail) => host.dispatchEvent(new win.CustomEvent(type, { detail }));
  const record = (method) => {
    diagnostics.commands.push(method);
    if (diagnostics.commands.length > 40) diagnostics.commands.shift();
  };
  function settlePlay(error) {
    win.clearTimeout(playTimer);
    for (const waiter of playWaiters.splice(0)) error ? waiter.reject(error) : waiter.resolve();
  }
  function reportError(message) {
    const error = message instanceof Error ? message : new Error(String(message));
    diagnostics.errors.push(error.message);
    settlePlay(error);
    emit('bunnyerror', { message: error.message });
  }
  function send(method, value) {
    if (!apiReady || !uiReady || !api) return;
    record(method);
    if (method === 'setPlaybackRate') api.send({ method, value });
    else api[method]?.(value);
  }
  function removeApiListeners() {
    for (const event of ['ready', 'timeupdate', 'play', 'pause', 'ended', 'seeked', 'error']) {
      api?.off?.(event);
    }
  }
  function updateTime(value, confirmed = false) {
    if (!Number.isFinite(value) || value < 0) return;
    // Ignore stale messages queued before an explicit seek. Never seek repeatedly
    // to "repair" a delayed event; Bunny remains in charge of the actual timeline.
    if (!confirmed && seekTarget !== null && Math.abs(value - seekTarget) > 2) return;
    time = value;
    if (seekTarget !== null) {
      seekTarget = null;
      emit('seeked');
    }
    emit('timeupdate');
  }
  function flush() {
    if (!apiReady || !uiReady || !api) return;
    cover?.remove();
    diagnostics.uiVersion = MC2_BUNNY_UI_VERSION;
    send('setVolume', volume * 100);
    send(muted ? 'mute' : 'unmute');
    send('setPlaybackRate', 1);
    const currentGeneration = generation;
    api.getDuration(value => {
      if (destroyed || !apiReady || currentGeneration !== generation) return;
      win.clearTimeout(startupTimer);
      if (Number.isFinite(value) && value > 0) duration = value;
      if (!metadataReady) {
        metadataReady = true;
        emit('loadedmetadata');
      }
      if (seekTarget !== null) send('setCurrentTime', seekTarget);
      if (wantedPlay) send('play');
    });
  }
  function onMessage(event) {
    if (event.origin !== PLAYER_ORIGIN || event.source !== frame?.contentWindow) return;
    if (event.data?.type !== 'mc2-bunny-ui-ready' || event.data.version !== MC2_BUNNY_UI_VERSION) return;
    if (uiReady) return;
    uiReady = true;
    flush();
  }
  win.addEventListener('message', onMessage);
  function onVisibility() {
    if (doc.visibilityState === 'hidden' || !wantedPlay || !apiReady || !uiReady) return;
    const currentGeneration = generation;
    // Mobile operating systems may pause in the background without delivering
    // an event until foregrounding. Offer the existing resume button, no loop.
    api.getPaused(value => {
      if (!destroyed && currentGeneration === generation && wantedPlay && value) {
        paused = true;
        emit('pause');
        emit('bunnyinterrupted');
      }
    });
  }
  doc.addEventListener('visibilitychange', onVisibility);

  async function loadSource(nextSource, { startAt = time } = {}) {
    const url = bunnyEmbedUrl(nextSource, startAt);
    const currentGeneration = ++generation;
    source = nextSource;
    removeApiListeners();
    api = null;
    frame?.remove();
    cover?.remove();
    win.clearTimeout(startupTimer);
    win.clearInterval(positionTimer);
    apiReady = uiReady = metadataReady = false;
    paused = true;
    ended = false;
    time = Math.max(0, Number(startAt) || 0);
    seekTarget = time;
    seekRevision++;
    seekRequestedAt = Date.now();
    emit('emptied');
    diagnostics.attachments++;
    startupTimer = win.setTimeout(() => reportError('Le lecteur Bunny ne répond pas. Réessaie.'), 15000);
    try {
      const playerjs = await loadApi(doc, win);
      if (destroyed || currentGeneration !== generation) return;
      frame = doc.createElement('iframe');
      frame.title = 'Masterclass Esprit Subconscient 2.0';
      frame.src = url;
      frame.allow = 'autoplay; fullscreen; encrypted-media';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.tabIndex = -1;
      // Bunny initializes on requestAnimationFrame: visibility:hidden can prevent
      // its ready event forever. Cover the loading surface, never hide the iframe.
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;pointer-events:none';
      cover = doc.createElement('div');
      cover.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none';
      host.append(frame);
      host.append(cover);
      api = new playerjs.Player(frame);
      const active = () => !destroyed && currentGeneration === generation;
      api.on('ready', () => {
        if (!active()) return;
        apiReady = true;
        frame.contentWindow.postMessage({ type: 'mc2-bunny-ui-probe' }, PLAYER_ORIGIN);
        flush();
      });
      api.on('timeupdate', raw => {
        if (!active()) return;
        let data = raw;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
        if (Number.isFinite(data?.duration) && data.duration > 0) duration = data.duration;
        updateTime(data?.seconds);
      });
      api.on('play', () => {
        if (!active()) return;
        if (!wantedPlay) { send('pause'); return; }
        paused = false;
        ended = false;
        settlePlay();
        emit('play');
        emit('playing');
      });
      api.on('pause', () => {
        if (!active()) return;
        paused = true;
        emit('pause');
        // An OS interruption is not a reason to repeatedly force play().
        // Native pause precedes ended. Do not flash the recovery UI during the
        // normal final frame; the existing page end handler owns that transition.
        if (wantedPlay && !ended && time < duration - 0.5 && doc.visibilityState !== 'hidden') emit('bunnyinterrupted');
      });
      api.on('ended', () => {
        if (!active()) return;
        paused = ended = true;
        wantedPlay = false;
        time = duration;
        settlePlay();
        emit('timeupdate');
        emit('ended');
      });
      api.on('seeked', () => {
        if (!active()) return;
        const revision = seekRevision;
        api.getCurrentTime(value => { if (active() && revision === seekRevision) updateTime(value, true); });
      });
      api.on('error', error => {
        if (!active()) return;
        reportError(error?.msg || 'Lecture interrompue. Clique pour reprendre.');
      });
      // Read-only fallback for the CTA/resume if a timeupdate message is missed.
      // This does not extrapolate time or depend on analytics/backend tracking.
      positionTimer = win.setInterval(() => {
        if (active() && apiReady && uiReady && !paused && doc.visibilityState !== 'hidden') {
          const revision = seekRevision;
          api.getCurrentTime(value => {
            if (active() && revision === seekRevision) {
              // A missing seeked event must never freeze the page's CTA clock.
              // After the short seek window use Bunny's actual reported time.
              updateTime(value, Date.now() - seekRequestedAt >= 5000);
            }
          });
        }
      }, 2000);
    } catch (error) {
      if (currentGeneration === generation && !destroyed) reportError(error);
    }
  }
  function play() {
    wantedPlay = true;
    if (!paused && apiReady && uiReady) return Promise.resolve();
    const promise = new Promise((resolve, reject) => playWaiters.push({ resolve, reject }));
    win.clearTimeout(playTimer);
    playTimer = win.setTimeout(() => reportError('Clique pour reprendre la lecture.'), 12000);
    if (apiReady && uiReady) {
      if (seekTarget !== null) send('setCurrentTime', seekTarget);
      send('play');
    }
    return promise;
  }
  function pause() {
    wantedPlay = false;
    settlePlay(new Error('Lecture interrompue par la page'));
    if (apiReady && uiReady && !paused) send('pause');
    paused = true;
  }
  Object.defineProperties(host, {
    currentTime: { get: () => time, set(value) {
      if (!Number.isFinite(value)) return;
      time = Math.max(0, Math.min(duration || Infinity, value));
      seekTarget = time;
      seekRevision++;
      seekRequestedAt = Date.now();
      ended = false;
      send('setCurrentTime', time);
    } },
    duration: { get: () => metadataReady ? duration : NaN },
    paused: { get: () => paused }, ended: { get: () => ended },
    seeking: { get: () => seekTarget !== null },
    readyState: { get: () => metadataReady ? (paused ? 1 : 4) : 0 },
    volume: { get: () => volume, set(value) {
      volume = Math.max(0, Math.min(1, Number(value) || 0));
      send('setVolume', volume * 100); emit('volumechange');
    } },
    muted: { get: () => muted, set(value) {
      muted = Boolean(value); send(muted ? 'mute' : 'unmute'); emit('volumechange');
    } },
    playbackRate: { get: () => 1, set() {} },
    defaultPlaybackRate: { get: () => 1, set() {} },
  });
  Object.assign(host, {
    play, pause, loadSource, diagnostics,
    retry() { void loadSource(source, { startAt: time }); return play(); },
    destroy() {
      destroyed = true;
      generation++;
      wantedPlay = false;
      win.clearTimeout(startupTimer);
      win.clearInterval(positionTimer);
      settlePlay(new Error('Lecteur fermé'));
      removeApiListeners();
      win.removeEventListener('message', onMessage);
      doc.removeEventListener('visibilitychange', onVisibility);
      frame?.remove();
      cover?.remove();
    },
  });
  return host;
}
