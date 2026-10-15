// Actual contiguous foreground playback only. Seeking never fills a gap.
export class DeltaWatch {
 constructor(){this.ranges=[];this.last=null;this.duration=0;}
 reset(){this.last=null;}
 sample(position,duration,now,playing,visible){
  if(!Number.isFinite(position)||position<0||position>7200)return;
  if(Number.isFinite(duration)&&duration>0&&duration<=7200)this.duration=duration;
  const last=this.last;this.last={position,now};
  if(!last||!playing||!visible)return;
  const wall=(now-last.now)/1000,delta=position-last.position;
  if(wall<=0||wall>3||delta<=0||delta>wall*2.5+.15)return;
  const ranges=[...this.ranges,[last.position,position]].sort((a,b)=>a[0]-b[0]),merged=[];
  for(const range of ranges){const tail=merged.at(-1);if(tail&&range[0]<=tail[1]+.03)tail[1]=Math.max(tail[1],range[1]);else merged.push([...range]);}
  this.ranges=merged.slice(0,1000);
 }
 snapshot(){
  const bins=new Map();let watched=0;
  for(const [start,end] of this.ranges){watched+=end-start;for(let b=Math.floor(start/10);b<=Math.floor(end/10)&&b<720;b++){const amount=Math.max(0,Math.min(end,(b+1)*10)-Math.max(start,b*10));if(amount)bins.set(b,Math.min(10,(bins.get(b)||0)+amount));}}
  return {watched:Math.round(watched*100)/100,duration:this.duration,bins:[...bins].map(([b,s])=>[b,Math.round(s*100)/100])};
 }
}
