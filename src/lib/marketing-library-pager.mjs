// Cursor pagination with no ceiling. Stale responses cannot replace a newer search.
export function createLibraryPager(read,onChange=()=>{}) {
  let generation=0;
  let state={items:[],total:0,cursor:null,loaded:false,loading:false,error:'',query:'',channel:''};
  const notify=()=>onChange({...state});
  async function run(append) {
    if(append && (state.loading||!state.cursor))return false;
    const version=++generation,cursor=append?state.cursor:null;
    state={...state,...(append?{}:{items:[],total:0,cursor:null,loaded:false}),loading:true,error:''};notify();
    try {
      const data=await read({query:state.query,channel:state.channel,cursor});
      if(version!==generation)return false;
      if(!Array.isArray(data.items)||!Number.isFinite(data.total))throw new Error('Réponse de la bibliothèque invalide.');
      if(data.next_cursor && (!data.items.length || JSON.stringify(data.next_cursor)===JSON.stringify(cursor)))throw new Error('La suite ne s’est pas chargée. Actualise la bibliothèque.');
      const rows=new Map((append?state.items:[]).map(row=>[row.id,row]));for(const row of data.items)rows.set(row.id,row);
      state={...state,items:[...rows.values()],total:data.total,cursor:data.next_cursor||null,loaded:true,loading:false};notify();return true;
    }catch(error){if(version!==generation)return false;state={...state,loading:false,error:error.message||'Chargement indisponible.'};notify();return false;}
  }
  return {
    get state(){return {...state};},
    reset(query='',channel=''){state={...state,query,channel};return run(false);},
    next(){return run(true);},
    clear(){generation++;state={items:[],total:0,cursor:null,loaded:false,loading:false,error:'',query:'',channel:''};notify();},
  };
}
