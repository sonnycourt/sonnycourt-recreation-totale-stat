// Gift classification only. No buyer group, status reset or email workflow.
export async function syncGiftRecipient(gift,{env=process.env,fetcher=fetch}={}) {
  const group=env.MAILERLITE_GROUP_DELTA_VISION_GIFTS;
  if(!group)return {enabled:false};
  if(!/^\d+$/.test(group) || !env.MAILERLITE_API_KEY)throw new Error('gift_mailerlite_config');
  const response=await fetcher('https://connect.mailerlite.com/api/subscribers',{
    method:'POST',headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({email:gift.recipient_email,fields:{name:gift.recipient_name},groups:[group]}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok || !(await response.json()).data?.id)throw new Error('gift_mailerlite_unconfirmed');
  return {enabled:true};
}
