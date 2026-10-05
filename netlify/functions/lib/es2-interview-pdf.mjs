import PDFDocument from 'pdfkit';
const C={navy:'#0C2343',blue:'#2368B5',ink:'#263B52',muted:'#61758C',light:'#EFF5FC',line:'#DCE7F4'};
const clean=s=>String(s||'').replace(/[\u2010-\u2015]/g,'-').replace(/\u202f|\u00a0/g,' ').replace(/[\u{1F300}-\u{1FAFF}]/gu,'').replace(/\*\*/g,'');
export function makeReportPdf(summary,firstName=''){
 return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margins:{top:54,bottom:58,left:48,right:48},bufferPages:true,info:{Title:'Ton point personnel - Esprit Subconscient 2.0',Author:'Sonny Court'}}),chunks=[];
 doc.on('data',c=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 const W=499,H=841.89;let sectionNo=0;
 function body(text,size=11){doc.font('Helvetica').fontSize(size).fillColor(C.ink).text(clean(text),48,doc.y,{width:W,lineGap:4});doc.moveDown(.7);}
 function label(text){doc.font('Helvetica-Bold').fontSize(9).fillColor(C.blue).text(clean(text).toUpperCase(),48,doc.y,{width:W,characterSpacing:1.1});doc.moveDown(.7);}
 function page(title,kicker){if(sectionNo++)doc.addPage();doc.rect(0,0,595.28,8).fill(C.blue);doc.y=42;label('ESPRIT SUBCONSCIENT 2.0 / POINT PERSONNEL');doc.moveDown(1.3);label(kicker);doc.font('Helvetica-Bold').fontSize(27).fillColor(C.navy).text(clean(title),48,doc.y,{width:W,lineGap:3});doc.moveDown(.8);}
 function heading(text){if(doc.y>690)doc.addPage();doc.font('Helvetica-Bold').fontSize(14).fillColor(C.navy).text(clean(text),48,doc.y,{width:W});doc.moveDown(.5);}
 function items(values){for(const value of values||[]){const y=doc.y;doc.circle(52,y+6,2).fill(C.blue);doc.font('Helvetica').fontSize(11).fillColor(C.ink).text(clean(value),65,y,{width:W-17,lineGap:4});doc.moveDown(.7);}}
 const r=summary.report;
 // The cover establishes a personal direction, then gives the source-grounded portrait.
 const title=clean(r.title||'Ton point personnel');
 doc.rect(0,0,595.28,218).fill(C.navy);doc.circle(557,12,124).fill('#123B66');doc.circle(579,18,82).fill('#194E81');
 doc.font('Helvetica-Bold').fontSize(9).fillColor('#A8D3FE').text('ESPRIT SUBCONSCIENT 2.0',48,35,{characterSpacing:1.7});
 let titleSize=26;while(titleSize>18&&doc.fontSize(titleSize).heightOfString(title,{width:455,lineGap:4})>96)titleSize--;
 doc.fontSize(titleSize).fillColor('#FFFFFF').text(title,48,76,{width:455,lineGap:4});
 doc.font('Helvetica').fontSize(10).fillColor('#BBD5ED').text('Ton point personnel'+(firstName?' / '+clean(firstName):''),48,187,{width:W});doc.y=243;sectionNo=1;
 label('01 / Comprendre ta situation');body(r.introduction);heading('Là où tu en es aujourd’hui');body(r.situation);heading('Ce qui se dessine dans ton récit');items(r.understanding);body('Les liens évoqués sont des pistes de compréhension issues de ton récit, pas des causes établies ni un diagnostic.',9);
 page('Ce vers quoi tu veux avancer','02 / Ta direction et tes appuis');
 const vy=doc.y;doc.font('Helvetica').fontSize(12);const vh=doc.heightOfString(clean(r.vision),{width:W-40,lineGap:5})+68;doc.roundedRect(48,vy,W,vh,12).fill(C.light);doc.font('Helvetica-Bold').fontSize(9).fillColor(C.blue).text('TA VISION',68,vy+20,{characterSpacing:1});doc.font('Helvetica').fontSize(12).fillColor(C.ink).text(clean(r.vision),68,vy+43,{width:W-40,lineGap:5});doc.y=vy+vh+26;
 heading('Les ressources sur lesquelles t’appuyer');
 for(const [i,value] of r.strengths.entries()){const y=doc.y;doc.circle(61,y+12,12).fill('#DCEBFA');doc.font('Helvetica-Bold').fontSize(10).fillColor(C.blue).text(String(i+1),56,y+8,{lineBreak:false});doc.font('Helvetica').fontSize(11).fillColor(C.ink).text(clean(value),88,y+2,{width:W-40,lineGap:4});doc.y=Math.max(doc.y,y+27)+15;}
 doc.moveDown(.6);heading('Ta question pour Sonny');const qy=doc.y;doc.rect(48,qy,3,doc.font('Helvetica').fontSize(12).heightOfString(clean(summary.priority_question),{width:W-24,lineGap:4})).fill(C.blue);doc.fillColor(C.ink).text(clean(summary.priority_question),65,qy,{width:W-24,lineGap:4});
 page('Une journée qui te ressemble','03 / Des repères adaptés à ta vie');body('Une proposition souple. Les jours difficiles, garde simplement la version minimale.',10);
 for(const [i,d] of r.day.entries()){
  const leftW=185,rightW=257,fs=10,gap=2;
  const measure=(t,w)=>doc.font('Helvetica').fontSize(fs).heightOfString(clean(t),{width:w,lineGap:gap});
  const textH=Math.max(measure(d.current,leftW),measure(d.proposal,rightW));const minH=measure(d.minimum,W-132);const height=64+textH+minH+27;
  if(doc.y+height>H-64){page('Ta journée, la suite','03 / Des repères adaptés à ta vie');}
  const y=doc.y;doc.roundedRect(48,y,W,height,10).fill(C.light);doc.circle(72,y+23,11).fill(C.blue);doc.font('Helvetica-Bold').fontSize(9).fillColor('white').text(String(i+1),69,y+19,{lineBreak:false});doc.font('Helvetica-Bold').fontSize(14).fillColor(C.navy).text(clean(d.moment),92,y+16,{width:W-60});
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text('AUJOURD’HUI',65,y+44,{width:leftW});doc.fillColor(C.blue).text('À ESSAYER',272,y+44,{width:rightW});
  doc.font('Helvetica').fontSize(fs).fillColor(C.ink).text(clean(d.current),65,y+60,{width:leftW,lineGap:gap});doc.text(clean(d.proposal),272,y+60,{width:rightW,lineGap:gap});
  const my=y+67+textH;doc.moveTo(65,my).lineTo(529,my).strokeColor('#D2E1F0').stroke();doc.font('Helvetica-Bold').fontSize(8).fillColor(C.blue).text('LE MINIMUM',65,my+11,{width:100});doc.font('Helvetica').fontSize(fs).fillColor(C.ink).text(clean(d.minimum),163,my+8,{width:W-132,lineGap:gap});doc.y=y+height+12;
 }
 page('Avancer, une étape à la fois','04 / Les prochaines semaines');
 for(const [i,w] of r.roadmap.entries()){label(w.period);heading(w.focus);items(w.actions);body('Ton repère : '+w.checkpoint,10);if(i<2){doc.moveTo(48,doc.y).lineTo(547,doc.y).strokeColor(C.line).stroke();doc.moveDown(1.1);}}
 body(r.closing,11);
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.save();doc.moveTo(48,H-43).lineTo(547,H-43).strokeColor(C.line).stroke();doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('SONNY COURT / TON POINT PERSONNEL',48,H-34,{lineBreak:false});doc.text(`${i+1} / ${range.count}`,505,H-34,{lineBreak:false});doc.restore();}doc.end();
 });
}
