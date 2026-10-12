// Only expose a country code, never the visitor's IP or precise location.
export default function handler(req,context={}) {
  if(req.method!=='GET')return new Response(null,{status:405});
  const detected=String(context.geo?.country?.code || '').toUpperCase();
  return new Response(JSON.stringify({country:/^[A-Z]{2}$/.test(detected)?detected:'FR'}),{
    headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'},
  });
}
