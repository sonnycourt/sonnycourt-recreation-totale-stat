import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { bunnyVideoId, bunnyEmbedUrl, mountMc2BunnyVideo, useMc2BunnyPlayer } from '../src/lib/mc2-bunny-player.mjs';

const id = '87943222-3a1e-48ec-ab14-8624d76ba5a1';
const source = `https://vz-601d6eb4-a9a.b-cdn.net/${id}/playlist.m3u8`;
assert.equal(bunnyVideoId(source), id);
assert.throws(() => bunnyVideoId('https://untrusted.example/video.m3u8'));
assert.throws(() => bunnyVideoId('javascript:alert(1)'));
assert.equal(useMc2BunnyPlayer(''), true, 'The validated official player is the production default');
assert.equal(useMc2BunnyPlayer('?preview=dev&player=bunny'), true);
assert.equal(useMc2BunnyPlayer('?token=existing-access-token'), true, 'Existing access links use Bunny without new parameters');
assert.equal(useMc2BunnyPlayer('?player=legacy'), false, 'Explicit diagnostic fallback remains available');
const embed = new URL(bunnyEmbedUrl(source, 1234));
assert.equal(embed.origin, 'https://player.mediadelivery.net');
assert.equal(embed.searchParams.get('t'), '1234');
assert.equal(embed.searchParams.get('autoplay'), 'false');
assert.equal(embed.searchParams.get('rememberPosition'), 'false');
assert.equal(embed.searchParams.get('mc2ui'), '1');
const head = readFileSync(new URL('../deploy/bunny-mc2-custom-head.html', import.meta.url), 'utf8');
const headScript = head.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const location of [
  {search:'', pathname:`/embed/698588/${id}`},
  {search:'?mc2ui=1', pathname:`/play/698588/${id}`},
  {search:'?mc2ui=1', pathname:`/embed/another-library/${id}`},
]) {
  assert.doesNotThrow(() => runInNewContext(headScript, {location, URLSearchParams}), 'Other Bunny players are untouched (no DOM access at all)');
}

function fixture() {
  let clock = 0, timerId = 0;
  const timers = new Map(), apis = [], sent = [];
  const win = new EventTarget();
  Object.assign(win, { CustomEvent,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: clock + ms, interval: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  class Element extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.attributes = []; this.dataset = {}; this.style = {}; this.children = []; this.ownerDocument = doc; this.contentWindow = { postMessage: (...args) => sent.push(args) }; }
    setAttribute(name, value) { this.attributes.push({ name, value }); }
    removeAttribute(name) { this.attributes = this.attributes.filter(x => x.name !== name); }
    replaceWith(node) { this.replacement = node; }
    append(node) { this.children.push(node); }
    remove() { this.removed = true; }
  }
  const doc = Object.assign(new EventTarget(), { defaultView: win, visibilityState: 'visible', createElement: name => new Element(name) });
  const initial = new Element('video'); initial.setAttribute('id', 'video');
  class Player {
    constructor(frame) { this.frame = frame; this.listeners = new Map(); this.commands = []; this.position = 0; apis.push(this); }
    on(name, fn) { this.listeners.set(name, fn); }
    off(name) { assert.equal(typeof name, 'string'); this.listeners.delete(name); }
    emit(name, data) { this.listeners.get(name)?.(data); }
    getDuration(cb) { cb(7908); }
    getCurrentTime(cb) { cb(this.position); }
    getPaused(cb) { cb(true); }
    setCurrentTime(t) { this.commands.push(['seek', t]); this.position = t; }
    setVolume(v) { this.commands.push(['volume', v]); }
    mute() { this.commands.push(['mute']); }
    unmute() { this.commands.push(['unmute']); }
    send(cmd) { this.commands.push([cmd.method, cmd.value]); }
    play() { this.commands.push(['play']); }
    pause() { this.commands.push(['pause']); }
  }
  const video = mountMc2BunnyVideo(initial, { fallbackDuration: 7908, loadApi: async () => ({ Player }) });
  const readyUi = (origin = 'https://player.mediadelivery.net', sourceWindow = apis.at(-1).frame.contentWindow) => {
    const event = new Event('message');
    Object.assign(event, { origin, source: sourceWindow, data: { type: 'mc2-bunny-ui-ready', version: 1 } });
    win.dispatchEvent(event);
  };
  const advance = ms => {
    const end = clock + ms;
    for (;;) {
      const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      const [id, t] = next; clock = t.at;
      if (t.interval) t.at += t.interval; else timers.delete(id);
      t.fn();
    }
    clock = end;
  };
  return { video, apis, readyUi, advance, timers, doc };
}

{
  const f = fixture(), events = [];
  f.video.addEventListener('loadedmetadata', () => events.push('metadata'));
  await f.video.loadSource(source, { startAt: 1020 });
  const p = f.apis[0];
  p.emit('ready');
  f.readyUi('https://attacker.example');
  f.readyUi('https://player.mediadelivery.net', {});
  assert.equal(p.commands.length, 0, 'Ignore forged UI handshake; do not start unconfigured iframe');
  f.readyUi();
  assert.deepEqual(events, ['metadata']);
  assert.equal(f.video.duration, 7908);
  const playing = f.video.play();
  p.emit('timeupdate', { seconds: 1020.25, duration: 7908 });
  p.emit('play');
  await playing;
  assert.equal(f.video.paused, false);
  f.video.currentTime = 1005;
  p.emit('timeupdate', { seconds: 1020.5 });
  assert.equal(f.video.currentTime, 1005, 'Ignore old messages while a requested seek is pending');
  p.emit('seeked');
  p.emit('timeupdate', { seconds: 1006 });
  assert.equal(f.video.currentTime, 1006);
  f.video.currentTime = 1100;
  p.position = 1106;
  p.emit('seeked');
  assert.equal(f.video.currentTime, 1106, 'An acknowledged seek accepts actual playback even after delayed messages');
  f.video.currentTime = 1006;
  p.emit('seeked');
  let interrupted = 0;
  f.video.addEventListener('bunnyinterrupted', () => interrupted++);
  f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(interrupted, 1, 'Foregrounding a background-paused mobile player offers manual resume');
  const playCommands = p.commands.filter(c => c[0] === 'play').length;
  p.emit('pause');
  f.advance(60000);
  assert.equal(p.commands.filter(c => c[0] === 'play').length, playCommands, 'No forced resume/recovery loop');
  assert.equal(f.apis.length, 1, 'No automatic iframe reconstruction');
  p.emit('timeupdate', {seconds:7907.9});
  const beforeEnd = interrupted;
  p.emit('pause');
  assert.equal(interrupted, beforeEnd, 'Native end-of-file pause is not a playback failure');
  p.emit('timeupdate', {seconds:1006});
  const old = p;
  const retry = f.video.retry();
  await Promise.resolve();
  const next = f.apis[1];
  assert.equal(new URL(next.frame.src).searchParams.get('t'), '1006', 'Manual retry preserves passage');
  old.emit('ended');
  assert.equal(f.video.ended, false, 'Old instance cannot alter current playback');
  next.emit('ready'); f.readyUi(); next.emit('play'); await retry;
  f.video.pause();
  next.emit('play');
  assert.equal(next.commands.at(-1)[0], 'pause', 'Access gate wins over a delayed play event');
  f.video.destroy();
  assert.equal(f.timers.size, 0, 'No timer left after unmount');
}
{
  const f = fixture();
  await f.video.loadSource(source);
  const p = f.apis[0]; p.emit('ready'); f.readyUi();
  const pending = f.video.play();
  const bounded = assert.rejects(pending, /reprendre/);
  f.advance(12001);
  await bounded;
  assert.equal(f.apis.length, 1, 'A missing play response never triggers automatic reload');
  f.video.destroy();
}
console.log('PASS — official embed only, scoped UI handshake, late join, bounded play, seek/resume, no forced recovery, access gates, cleanup.');
