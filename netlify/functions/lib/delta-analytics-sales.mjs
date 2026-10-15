// Dedicated read-only client: keep payment/onboarding helpers untouched.
async function spiffyRead(path,params){
 const key=String(process.env.SPIFFY_ONBOARDING_API_KEY||'').trim();
 if(!key)throw Error('spiffy_not_configured');
 if(path!=='orders')throw Error('invalid_read');
 const url=new URL('https://api.spiffy.co/v2/orders');for(const [name,value]of Object.entries(params))url.searchParams.set(name,String(value));
 for(let attempt=0;attempt<2;attempt++){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(response.ok)return response.json();
  if(attempt===0&&[429,502,503,504].includes(response.status)){await new Promise(resolve=>setTimeout(resolve,500));continue;}
  const error=Error('spiffy_unavailable');error.status=response.status;throw error;
 }
}
const checkouts=new Set(['41037','41049','41096']);
function references(value,depth=0){
 if(depth>8)return [];
 if(typeof value==='string')return /^dv1_[0-9a-f-]{36}$/i.test(value)?[value.slice(4)]:[];
 if(!value||typeof value!=='object')return [];
 return Object.values(value).flatMap(v=>references(v,depth+1));
}
export function verifiedSale(order){
 if(!checkouts.has(String(order?.checkout?.id??order?.checkout_id))||order.payment_status!=='succeeded'||!Array.isArray(order.payments))return null;
 const payments=order.payments.filter(p=>String(p.order_id)===String(order.id)&&p.status==='succeeded'&&String(p.currency).toLowerCase()==='eur'&&Number.isSafeInteger(Number(p.amount_paid))&&Number(p.amount_paid)>0)
  .sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
 if(!payments.length)return null;
 const payment=payments[0],refund=Number(payment.amount_refunded||0);
 if(!Number.isFinite(refund)||refund<0)return null;
 const refs=[...new Set([...references(order.attribution),...references(order.preserved_params)])];
 return {order_id:String(order.id),created_at:order.created_at,initial_minor:Number(payment.amount_paid),refunded_minor:refund,net_minor:Math.max(0,Number(payment.amount_paid)-refund),currency:'EUR',visit_id:refs.length===1?refs[0]:null};
}
export async function readDeltaSales(from,read=spiffyRead){
 const orders=[],started=Date.now();let total=null;
 for(let page=1;page<=5;page++){
  if(Date.now()-started>18000)throw Error('sales_timeout');
  const response=await read('orders',{'filter[created_at.gte]':from,include:'attribution,payments,checkout',per_page:100,page});
  const count=response.meta?.pagination?.total_count??response.pagination?.total;
  if(!Array.isArray(response.data)||!Number.isInteger(count)||count<0||(total!==null&&total!==count))throw Error('sales_incomplete');
  total=count;orders.push(...response.data);
  if(orders.length===total){
   const candidates=orders.filter(o=>Date.parse(o.created_at)>=Date.parse(from)&&checkouts.has(String(o.checkout?.id??o.checkout_id)));
   const sales=candidates.map(verifiedSale).filter(Boolean);
   return {available:true,sales,unverified:candidates.filter(o=>o.payment_status==='succeeded'&&!verifiedSale(o)).length,checked_at:new Date().toISOString()};
  }
  if(!response.data.length||orders.length>total)throw Error('sales_incomplete');
 }
 throw Error('sales_limit');
}
