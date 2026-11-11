import { CHANNELS, UUID } from '../../../src/lib/marketing-links-contract.mjs';
import { database } from './marketing-links.mjs';

export function libraryInput(url) {
  const view=url.searchParams.get('view');
  const search=(url.searchParams.get('q')||'').trim(),channel=url.searchParams.get('channel')||'';
  const at=url.searchParams.get('before_at')||null,id=url.searchParams.get('before_id')||null;
  if(!['summary','links','contents'].includes(view) || search.length>200 || (channel&&!Object.hasOwn(CHANNELS,channel))
    || Boolean(at)!==Boolean(id) || (id&&!UUID.test(id))
    || (at&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(at)||!Number.isFinite(Date.parse(at))))) {
    throw new Error('invalid_library_query');
  }
  // Preserve PostgreSQL microseconds verbatim: Date.toISOString() would drop them.
  return {p_kind:view,p_search:search,p_channel:channel,p_before_at:at,p_before_id:id,p_take:view==='links'?12:24};
}
export async function readLibrary(url,read=database) {
  return read('rpc/marketing_library_page',libraryInput(url));
}
