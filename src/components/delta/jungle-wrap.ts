// Short-lived cylindrical texture warp. The player sits between two canvases:
// strips on the rear half are actually occluded by the opaque player, not faded.
type Piece = { bitmap: HTMLCanvasElement; x: number; y: number; edge: 'left'|'right'|'top'; rear: boolean };
const TAU_HALF = Math.PI;

export function createJungleWrap(stage: HTMLElement) {
  let frame = 0;
  let surfaces: HTMLCanvasElement[] = [];
  let epoch = 0;
  let onFinished: (() => void) | undefined;
  const finish = () => {
    const callback = onFinished;
    onFinished = undefined;
    callback?.();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    epoch++;
    surfaces.forEach(canvas => canvas.remove());
    surfaces = [];
    stage.classList.remove('is-wrapping');
    finish();
  };

  function texture(layer: HTMLElement, stageWidth: number): Piece | null {
    const image = layer.querySelector<HTMLImageElement>('img')!;
    if (!image.complete || !image.naturalWidth) return null;
    const w = layer.offsetWidth, h = layer.offsetHeight;
    const crown = layer.classList.contains('jungle-crown');
    const right = layer.classList.contains('jungle-side-right');
    const rear = layer.classList.contains('jungle-back');
    const angle = crown ? Math.PI / 10 : 0;
    const margin = 26;
    const width = Math.ceil(Math.abs(w*Math.cos(angle)) + Math.abs(h*Math.sin(angle)) + margin*2);
    const height = Math.ceil(Math.abs(h*Math.cos(angle)) + Math.abs(w*Math.sin(angle)) + margin*2);
    const bitmap = document.createElement('canvas');
    bitmap.width = width; bitmap.height = height;
    const ctx = bitmap.getContext('2d')!;
    ctx.translate(width/2, height/2);
    ctx.rotate(angle);
    if (right) ctx.scale(-1, 1);
    ctx.translate(-w/2, -h/2);
    // Match the existing resting decoration, including its fixed tuck mask.
    if (crown && !rear) {
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(w*.78,0);
      ctx.lineTo(w,h*.44); ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.clip();
    }
    ctx.filter = right ? 'brightness(.85) drop-shadow(4px 7px 5px #1423163b)' : crown ? 'drop-shadow(6px 10px 7px #182b1645)' : 'drop-shadow(4px 7px 5px #1423163b)';
    const imageScale = crown ? 1 : new DOMMatrix(getComputedStyle(image).transform).a;
    ctx.save();
    ctx.translate(w/2, 0); ctx.scale(imageScale,1); ctx.translate(-w/2,0);
    ctx.drawImage(image, 0, 0, w, h);
    ctx.restore();
    ctx.filter = 'none';
    if (!crown && !rear) {
      const mask = ctx.createLinearGradient(0,0,0,h);
      mask.addColorStop(0,'transparent'); mask.addColorStop(.06,'transparent');
      mask.addColorStop(.24,'#000'); mask.addColorStop(.72,'#000');
      mask.addColorStop(.94,'transparent'); mask.addColorStop(1,'transparent');
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = mask;
      ctx.fillRect(-margin,-margin,w+margin*2,h+margin*2);
    }
    const left = right ? stageWidth - parseFloat(getComputedStyle(layer).right) - w : layer.offsetLeft;
    return { bitmap, x:left+w/2-width/2, y:layer.offsetTop+h/2-height/2, edge:crown?'top':right?'right':'left', rear };
  }

  const start = (onComplete?: () => void) => {
    stop();
    onFinished = onComplete;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const w = stage.offsetWidth, h = stage.offsetHeight;
    const pieces = [...stage.querySelectorAll<HTMLElement>('.jungle-side,.jungle-crown')].map(layer=>texture(layer,w)).filter((p):p is Piece=>Boolean(p));
    if (!pieces.length) { finish(); return; }
    const pad = Math.ceil(Math.max(140, w*.2));
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    surfaces = [1,5].map(z => {
      const canvas = document.createElement('canvas');
      canvas.className = 'jungle-wrap-canvas'; canvas.setAttribute('aria-hidden','true');
      canvas.width = Math.ceil((w+2*pad)*ratio); canvas.height = Math.ceil((h+2*pad)*ratio);
      Object.assign(canvas.style,{position:'absolute',left:`${-pad}px`,top:`${-pad}px`,width:`${w+2*pad}px`,height:`${h+2*pad}px`,zIndex:String(z),pointerEvents:'none'});
      stage.append(canvas); return canvas;
    });
    const contexts = surfaces.map(c=>c.getContext('2d')!);
    const availableRim = Math.max(16, stage.getBoundingClientRect().left-4);
    const radius = Math.min(Math.max(16,w*.105),availableRim);
    const strip = w < 600 ? 1 : 1.5;
    const travel = w*.48 + Math.PI*radius;
    const began = performance.now();
    const token = epoch;
    stage.classList.add('is-wrapping');

    // s is distance along the front, rounded rim, then back of the player.
    function project(position: number, distance: number) {
      const initialArc = position >= 0 ? position : -radius*Math.asin(Math.min(1,-position/radius));
      const s = initialArc-distance;
      if (s >= 0) return {position:s, rear:false,depth:0};
      if (s > -TAU_HALF*radius) return {position:-radius*Math.sin(-s/radius),rear:true,depth:radius*(1-Math.cos(-s/radius))};
      return {position:-s-TAU_HALF*radius,rear:true,depth:2*radius};
    }

    function draw(now: number) {
      if (token !== epoch) return;
      for (const ctx of contexts) {
        ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
        ctx.setTransform(ratio,0,0,ratio,pad*ratio,pad*ratio);
      }
      for (const piece of pieces) {
        const delay = piece.edge === 'right' ? 110 : piece.edge === 'top' ? 65 : 0;
        const t = Math.max(0,Math.min(1,(now-began-delay)/1900));
        const eased = t*t*(3-2*t);
        const distance = travel*eased;
        const vertical = piece.edge === 'top';
        const length = vertical ? piece.bitmap.height : piece.bitmap.width;
        for (let at=0; at<length; at+=strip) {
          const size = Math.min(strip,length-at);
          const startAt = vertical ? piece.y+at : piece.x+at;
          const edgePosition = piece.edge==='right' ? w-startAt : startAt;
          const a=project(edgePosition,distance);
          const b=project(edgePosition+(piece.edge==='right'?-size:size),distance);
          const mid=project(edgePosition+(piece.edge==='right'?-size:size)/2,distance);
          const ctx=contexts[piece.rear||mid.rear?0:1];
          // Adjacent strips share exact device-pixel edges. No alpha overlap
          // (which would leave dark comb-like seams on translucent leaf edges).
          const p1=Math.round((piece.edge==='right'?w-a.position:a.position)*ratio)/ratio;
          const p2=Math.round((piece.edge==='right'?w-b.position:b.position)*ratio)/ratio;
          const scale=(p2-p1)/size;
          const perspective=w*1.2/(w*1.2+mid.depth);
          if (Math.abs(scale)<.015) continue;
          ctx.save();
          if(vertical){
            ctx.translate(w/2+(piece.x-w/2)*perspective,p1); ctx.scale(perspective,scale);
            ctx.drawImage(piece.bitmap,0,at,piece.bitmap.width,size,0,0,piece.bitmap.width,size);
          }else{
            ctx.translate(p1,h/2+(piece.y-h/2)*perspective); ctx.scale(scale,perspective);
            ctx.drawImage(piece.bitmap,at,0,size,piece.bitmap.height,0,0,size,piece.bitmap.height);
          }
          ctx.restore();
        }
      }
      if(now-began<2050) frame=requestAnimationFrame(draw);
      else { frame=0; surfaces.forEach(canvas=>canvas.remove()); surfaces=[]; finish(); }
    }
    draw(began);
    frame=requestAnimationFrame(draw);
  };
  window.addEventListener('resize',stop);
  return {start,stop};
}

