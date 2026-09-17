// Segmentation commerciale existante : admin-masterclass-optin.js.
// Ce classement par pays ne décrit pas la solvabilité d'une personne.
export const HIGH_POWER_COUNTRIES = ['FR', 'BE', 'CH', 'CA', 'LU', 'MC', 'DE'];
export const COUNTRY_GROUPS = ['all', 'high', 'other', 'unknown'];
const names = new Intl.DisplayNames(['fr'], {type:'region',fallback:'none'});

export function caseCountryGroup(row) {
  const code=String(row.country_override || row.country || '').trim().toUpperCase();
  if(!/^[A-Z]{2}$/.test(code) || ['ZZ','XX','EU','UN','QO'].includes(code) || !names.of(code))return 'unknown';
  return HIGH_POWER_COUNTRIES.includes(code)?'high':'other';
}
export function isCaseDue(row, now=Date.now()) {
  return !['done','paused'].includes(row.status) && (row.status==='new' || Date.parse(row.followup_at)<=now);
}

// Filtre avant pagination ; les compteurs portent sur le groupe choisi, comme
// les compteurs existants ils restent indépendants de la recherche et du statut.
export function countryGroupPage(rows,{group='all',filter='all',search='',offset=0,now=Date.now()}={}) {
  const scoped=rows.filter(row=>group==='all'||caseCountryGroup(row)===group);
  const counts={all:scoped.length,new:0,due:0,booked:0,done:0,paused:0};
  for(const row of scoped){
    if(Object.hasOwn(counts,row.status)&&row.status!=='all'&&row.status!=='due')counts[row.status]++;
    if(isCaseDue(row,now))counts.due++;
  }
  const needle=search.trim().toLowerCase();
  const selected=scoped.filter(row=>{
    if(filter!=='all' && !(filter==='due'?isCaseDue(row,now):row.status===filter))return false;
    if(!needle)return true;
    const code=String(row.country_override||row.country||'').toUpperCase();
    const label=/^[A-Z]{2}$/.test(code)?names.of(code)||'':'';
    return [row.display_name,row.preferred_name,row.name,row.email,row.phone,row.country,row.country_override,row.city,label,code==='CD'?'RDC Congo':''].join(' ').toLowerCase().includes(needle);
  });
  selected.sort((a,b)=>Number(isCaseDue(b,now))-Number(isCaseDue(a,now))
    || (Date.parse(a.followup_at||a.purchased_at)||0)-(Date.parse(b.followup_at||b.purchased_at)||0)
    || String(a.id).localeCompare(String(b.id)));
  return {cases:selected.slice(offset,offset+50),total:selected.length,counts};
}
