// Segmentation commerciale existante : admin-masterclass-optin.js.
// Ce classement par pays ne décrit pas la solvabilité d'une personne.
export const HIGH_POWER_COUNTRIES = ['FR', 'BE', 'CH', 'CA', 'LU', 'MC', 'DE'];
export const COUNTRY_GROUPS = ['all', 'high', 'other', 'unknown'];
const names = new Intl.DisplayNames(['fr'], {type:'region',fallback:'none'});
const englishNames = new Intl.DisplayNames(['en'], {type:'region',fallback:'none'});
const countryCodes = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK'.split(' '));
const countryKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases=new Map();
for(const code of countryCodes){aliases.set(countryKey(names.of(code)),code);aliases.set(countryKey(englishNames.of(code)),code);}
for(const [name,code] of [['RDC','CD'],['République démocratique du Congo','CD'],['Democratic Republic of the Congo','CD'],['UK','GB']])aliases.set(countryKey(name),code);
export function normalizedCaseCountry(row) {
  const value=String(row.country_override||row.country||'').trim();
  return countryCodes.has(value.toUpperCase())?value.toUpperCase():aliases.get(countryKey(value))||null;
}

export function caseCountryGroup(row) {
  const code=normalizedCaseCountry(row);
  if(!code)return 'unknown';
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
    const code=normalizedCaseCountry(row);
    const label=code?names.of(code)||'':'';
    return [row.display_name,row.preferred_name,row.name,row.email,row.phone,row.country,row.country_override,row.city,label,code==='CD'?'RDC Congo':''].join(' ').toLowerCase().includes(needle);
  });
  selected.sort((a,b)=>Number(isCaseDue(b,now))-Number(isCaseDue(a,now))
    || (Date.parse(a.followup_at||a.purchased_at)||0)-(Date.parse(b.followup_at||b.purchased_at)||0)
    || String(a.id).localeCompare(String(b.id)));
  return {cases:selected.slice(offset,offset+50),total:selected.length,counts};
}
