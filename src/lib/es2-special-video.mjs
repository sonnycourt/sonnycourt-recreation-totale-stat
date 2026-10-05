// Bunny owns streaming, quality and controls. Our thumbnail only launches it.
function connectPlayer(frame) {
  const doc = frame.ownerDocument;
  const win = doc.defaultView;
  return new Promise((resolve, reject) => {
    const connect = () => {
      if (!win.playerjs?.Player) return reject(new Error('Bunny API unavailable'));
      const player = new win.playerjs.Player(frame);
      player.on('ready', () => resolve(player));
    };
    if (win.playerjs?.Player) return connect();
    const script = doc.createElement('script');
    script.src = 'https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js';
    script.async = true;
    script.onload = connect;
    script.onerror = reject;
    doc.head.appendChild(script);
  });
}

export function initSpecialVideo(root, connect = connectPlayer) {
  if (!root || root.dataset.ready) return;
  const frame = root.querySelector('iframe');
  const poster = root.querySelector('[data-vsl-play]');
  if (!frame || !poster) return;
  const url = new URL(frame.src);
  url.searchParams.set('autoplay', 'true');
  root.dataset.ready = 'true';
  poster.hidden = false;
  let started = false;
  let player = null;
  const ready = connect(frame).then(api => { player = api; return api; }).catch(() => null);
  poster.addEventListener('click', () => {
    if (started) return;
    started = true;
    poster.hidden = true;
    if (player) player.play();
    else ready.then(api => {
      if (api) api.play();
      else frame.src = url.href;
    });
  });
}
