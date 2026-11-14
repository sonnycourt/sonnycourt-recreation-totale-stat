import { readDvpToken, rememberDvpAccess, priorBrowserDeadline, resolveDvpAccess } from './dvp-access-client.mjs';
import Hls from 'hls.js';
import { secondsUntilDvpOffer, formatDvpCountdown } from './dvp-video-gate.mjs';

export function initDvpOptin() {
  const modal = document.querySelector<HTMLDialogElement>('#dvp-optin')!;
  const root = document.querySelector<HTMLElement>('[data-inspira-video]')!;
  const posterPlay = root.querySelector<HTMLButtonElement>('[data-video-play]')!;
  const form = modal.querySelector<HTMLFormElement>('form')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const error = form.querySelector<HTMLElement>('.form-error')!;
  const badges = document.querySelector<HTMLElement>('.dvp-badges')!;
  const offer = document.querySelector<HTMLElement>('.dvp-offer')!;
  const offerButton = offer.querySelector<HTMLAnchorElement>('.dvp-offer-button')!;
  const countdown = offer.querySelector<HTMLElement>('.dvp-offer-countdown')!;
  const timer = offer.querySelector<HTMLElement>('[data-offer-timer]')!;
  const controls = document.querySelector<HTMLElement>('.dvp-controls')!;
  const toggle = controls.querySelector<HTMLButtonElement>('[data-toggle-play]')!;
  const volumeButton = controls.querySelector<HTMLButtonElement>('[data-toggle-volume]')!;
  const volumePanel = controls.querySelector<HTMLElement>('[data-volume-panel]')!;
  const volume = controls.querySelector<HTMLInputElement>('[data-volume]')!;
  const mute = controls.querySelector<HTMLButtonElement>('[data-mute]')!;
  const playerStatus = document.querySelector<HTMLElement>('[data-player-status]')!;
  let accepted = false, started = false, unlocked = false, prepared = false, busy = false;
  let furthest = 0, reverting = false, hls: Hls | undefined;
  let accessToken: string | null = null, resumeAt = 0, lastProgress = 0;
  const saveProgress = () => {
    if(!accessToken || !accepted) return;
    lastProgress = Date.now();
    void fetch('/.netlify/functions/dvp-access',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'progress',token:accessToken,position:furthest,offerUnlocked:unlocked}),keepalive:true}).catch(()=>{});
  };
  const video = document.createElement('video');
  video.className = 'dvp-native-video';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('disableremoteplayback', '');
  video.setAttribute('x-webkit-airplay','deny');
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.controls = false;
  video.preload = 'auto';
  video.muted = true;
  video.tabIndex = -1;
  video.setAttribute('aria-hidden','true');
  root.append(video);
  const syncPlay = () => {
    toggle.setAttribute('aria-label', video.paused ? 'Lire la vidéo' : 'Mettre en pause');
    toggle.dataset.paused = String(video.paused);
  };
  const syncVolume = () => {
    mute.textContent = video.muted ? 'Activer le son' : 'Couper le son';
    volumeButton.dataset.muted = String(video.muted || video.volume === 0);
    volume.value = String(video.volume * 100);
  };
  const showOffer = () => {
    if (!accepted || started) return;
    started = true; badges.hidden = true; offer.hidden = false;
  };
  const updateOffer = () => {
    if (!accepted || !started || unlocked) return;
    const remaining = secondsUntilDvpOffer(video.currentTime, video.duration);
    if (remaining === null) return;
    timer.textContent = formatDvpCountdown(remaining);
    if (remaining === 0) {
      unlocked = true; offerButton.href = '/delta-vision/#dvp=' + accessToken;
      offerButton.setAttribute('aria-disabled','false'); offerButton.removeAttribute('tabindex');
      countdown.hidden = true;
      offer.querySelector<HTMLElement>('.dvp-offer-ready')!.hidden = false;
      saveProgress();
    }
  };
  const attemptPlay = () => {
    playerStatus.hidden = true;
    void video.play().catch(() => {
      syncPlay();
      if (accepted) { playerStatus.textContent = 'Appuie sur Play pour lancer la vidéo.'; playerStatus.hidden = false; }
    });
  };
  const playbackError = () => {
    if (!accepted) return;
    playerStatus.textContent = 'La vidéo ne charge pas. Vérifie ta connexion puis appuie sur Play pour réessayer.';
    playerStatus.hidden = false;
  };
  const prepare = () => {
    if (prepared) return;
    prepared = true;
    const source = root.dataset.videoStream!;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
    } else if (Hls.isSupported()) {
      hls = new Hls({maxBufferLength:30, capLevelToPlayerSize:true});
      hls.loadSource(source); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => { if(data.fatal) playbackError(); });
    } else { video.src = source; }
  };
  // No native surface receives taps, long presses, double clicks or keyboard seeks.
  root.addEventListener('contextmenu', event => event.preventDefault());
  controls.addEventListener('contextmenu', event => event.preventDefault());
  root.addEventListener('dblclick', event => event.preventDefault());
  video.addEventListener('webkitbeginfullscreen', () => { (video as any).webkitExitFullscreen?.(); });
  video.addEventListener('enterpictureinpicture', () => { void document.exitPictureInPicture?.().catch(() => {}); });
  video.addEventListener('seeking', () => {
    if (!accepted || reverting) return;
    if (Math.abs(video.currentTime - furthest) > 1) { reverting = true; video.currentTime = furthest; }
  });
  video.addEventListener('seeked', () => { reverting = false; });
  video.addEventListener('ratechange', () => { if(video.playbackRate !== 1) video.playbackRate = 1; });
  video.addEventListener('timeupdate', () => {
    if(!accepted || video.seeking || reverting) return;
    furthest = Math.max(furthest,video.currentTime);
    if(Date.now()-lastProgress>10000) saveProgress();
    if(!video.paused) showOffer(); updateOffer();
  });
  video.addEventListener('play', () => { syncPlay(); showOffer(); updateOffer(); });
  video.addEventListener('pause', () => { syncPlay(); saveProgress(); });
  video.addEventListener('loadedmetadata', () => {
    if(resumeAt>0) { furthest=Math.min(resumeAt,video.duration); video.currentTime=furthest; resumeAt=0; }
    updateOffer();
  });
  video.addEventListener('volumechange', syncVolume);
  video.addEventListener('error', playbackError);
  video.addEventListener('ended', () => { syncPlay(); showOffer(); updateOffer(); });
  toggle.addEventListener('click', () => {
    if(!accepted) return;
    if(video.paused) { if(video.ended) { furthest=0; video.currentTime=0; } hls?.startLoad(); attemptPlay(); }
    else video.pause();
  });
  volumeButton.addEventListener('click', () => {
    volumePanel.hidden = !volumePanel.hidden;
    volumeButton.setAttribute('aria-expanded',String(!volumePanel.hidden));
  });
  volume.addEventListener('input', () => { video.volume = Number(volume.value)/100; video.muted = video.volume === 0; });
  mute.addEventListener('click', () => { video.muted=!video.muted; if(!video.muted && video.volume===0) video.volume=1; });
  controls.addEventListener('keydown', event => {
    if(event.key==='Escape') { volumePanel.hidden=true; volumeButton.setAttribute('aria-expanded','false'); volumeButton.focus(); }
  });
  offerButton.addEventListener('click', event => { if (!unlocked) event.preventDefault(); });
  let resolving = false;
  const activateAccess = (access: any,autoplay: boolean) => {
    accessToken=access.token;
    rememberDvpAccess(window,access);
    video.pause(); furthest=Number(access.position)||0; resumeAt=furthest; accepted=true;
    if(Number.isFinite(video.duration)) {video.currentTime=Math.min(furthest,video.duration);resumeAt=0;}
    modal.close(); root.closest('[data-jungle-stage]')?.classList.add('is-open');
    root.querySelector('.video-thumbnail')?.remove(); posterPlay.remove();
    root.dataset.videoState='visible'; controls.hidden=false;
    video.muted=false; syncPlay(); syncVolume();
    if(access.offerUnlocked) {
      showOffer(); unlocked=true;offerButton.href='/delta-vision/#dvp='+accessToken;
      offerButton.setAttribute('aria-disabled','false');offerButton.removeAttribute('tabindex');countdown.hidden=true;
      offer.querySelector<HTMLElement>('.dvp-offer-ready')!.hidden=false;
    }
    if(autoplay) {attemptPlay();root.scrollIntoView({behavior:'smooth',block:'center'});toggle.focus({preventScroll:true});}
    else {showOffer();updateOffer();}
  };
  const recoverAccess = async (token: string) => {
    resolving=true;
    posterPlay.disabled=true;
    try {const access=await resolveDvpAccess(window,token);prepare();activateAccess(access,false);}
    catch {
      playerStatus.textContent='Ton accès ne peut pas être chargé. Clique sur la vidéo pour réessayer.';
      playerStatus.hidden=false;
    } finally {resolving=false;posterPlay.disabled=false;}
  };
  posterPlay.addEventListener('click', () => {
    if(resolving) return;
    const token=readDvpToken(window,{remembered:true});
    if(token){void recoverAccess(token);return;}
    prepare(); modal.showModal(); document.body.style.overflow='hidden';
    form.querySelector<HTMLInputElement>('[name=firstName]')!.focus();
  });
  const close = () => { if(!busy) modal.close(); };
  modal.querySelector('.modal-close')!.addEventListener('click',close);
  modal.addEventListener('cancel', event => { if(busy) event.preventDefault(); });
  modal.addEventListener('click',event => {
    if(event.target !== modal) return;
    const r=modal.getBoundingClientRect();
    if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) close();
  });
  modal.addEventListener('close',() => { document.body.style.overflow=''; });
  form.addEventListener('submit',async event => {
    event.preventDefault(); if(busy) return;
    busy=true; submit.disabled=true; submit.textContent='Ouverture de ta vidéo…'; error.hidden=true;
    video.muted=true; attemptPlay();
    try {
      const data=new FormData(form);
      const response=await fetch('/.netlify/functions/dvp-register',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({firstName:data.get('firstName'),email:data.get('email'),website:data.get('website'),consent:true,browserDeadline:priorBrowserDeadline(document,window)}),
        signal:AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if(!response.ok || !result.ok || !result.access?.token) throw Error('registration');
      activateAccess(result.access,true);
      form.reset();
    } catch {
      video.pause(); video.currentTime=0;
      error.textContent='L’inscription n’a pas abouti. Vérifie ta connexion puis réessaie.'; error.hidden=false;
    } finally {
      busy=false; submit.disabled=false; submit.innerHTML='Je découvre la vidéo <span aria-hidden="true">→</span>';
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveProgress();});
  window.addEventListener('pagehide',()=>{saveProgress();video.pause();hls?.stopLoad();});
  const existing=readDvpToken(window,{remembered:true});
  if(existing) void recoverAccess(existing);
}
