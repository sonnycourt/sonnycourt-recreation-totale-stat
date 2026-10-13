import {giftReady,giftSpaceIds,giftDb,giftRpc,giftOrder,giftRecord,giftEmailContent,emailValue} from './delta-gifts.mjs';
import {syncGiftRecipient} from './delta-gifts-mailerlite.mjs';

const circleBase='https://app.circle.so/api/admin/v2';
export async function fulfillGift(gift,{env=process.env,fetcher=fetch}={}){
  if(!giftReady(env))throw new Error('not_ready');
  const request=async(path,body)=>{
    const response=await fetcher(`${circleBase}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${env.CIRCLE_ADMIN_API_TOKEN}`,'Content-Type':'application/json',Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    if(response.status===404 && !body)return null;
    if(!response.ok)throw new Error(`circle_${response.status}`);
    return response.json();
  };
  const email=gift.recipient_email,group=Number(env.DELTA_GIFTS_CIRCLE_GROUP_ID),spaces=giftSpaceIds(env);
  // Validate the configured spaces before changing ANY membership. Never use an ES2 tag.
  for(const id of spaces){
    const space=await request(`spaces/${id}`);
    if(Number(space?.space_group?.id ?? space?.space_group_id)!==group || space?.space_type!=='course' || space?.is_private!==true || space?.is_hidden_from_non_members!==true || space?.is_draft!==false)throw new Error('circle_space_group_mismatch');
  }
  const unwrap=payload=>payload?.community_member || payload?.data?.community_member || payload?.data || payload;
  let member=unwrap(await request(`community_members/search?email=${encodeURIComponent(email)}`));
  if(!member){
    // Never grant the parent FORMATIONS group: it contains other paid courses.
    member=unwrap(await request('community_members',{email,name:gift.recipient_name,skip_invitation:false,space_group_ids:[],space_ids:spaces,member_tag_ids:[]}));
  }
  if(!member?.id || emailValue(member.email)!==email)throw new Error('circle_identity_mismatch');
  for(const id of spaces){
    const query=`email=${encodeURIComponent(email)}&space_id=${id}`;
    let spaceMember=await request(`space_member?${query}`);
    if(!spaceMember || spaceMember.status==='inactive'){
      await request('space_members',{email,space_id:id});
      spaceMember=await request(`space_member?${query}`);
    }
    if(Number(spaceMember?.space_id)!==id || spaceMember?.status!=='active' || String(spaceMember.community_member_id)!==String(member.id))throw new Error('circle_space_not_confirmed');
  }
  return String(member.id);
}

export async function runGiftJobs({env=process.env,fetcher=fetch}={}){
  if(!giftReady(env))return {enabled:false,processed:0};
  const db={env,fetcher};
  const jobs=await giftRpc('dv_gift_claim_jobs',{p_kinds:['owner_email','gift_email','activate'],p_limit:3},db);
  let completed=0,failed=0;
  for(const job of jobs || []){
    const lease=`dv_gift_jobs?id=eq.${job.id}&lock_token=eq.${job.lock_token}&state=eq.processing`;
    try{
      const order=await giftOrder(job.order_id,db),gift=job.gift_id?await giftRecord(job.gift_id,db):null;
      if(order?.status!=='paid' || (job.gift_id && (!gift || gift.order_id!==order.id || !['assigned','activating','active'].includes(gift.state))))throw new Error('gift_unavailable');
      if(job.kind==='activate'){
        if(gift.state!=='active'){
          if(gift.state!=='activating')throw new Error('gift_not_activating');
          const memberId=await fulfillGift(gift,{env,fetcher});
          // Check the order again after the provider call. Never revive a locally revoked gift.
          if((await giftOrder(order.id,db))?.status!=='paid')throw new Error('gift_unavailable');
          const changed=await giftDb(`dv_gifts?id=eq.${gift.id}&state=eq.activating`,{...db,method:'PATCH',body:{state:'active',circle_member_id:memberId,activated_at:new Date().toISOString()}});
          if(!changed?.length && (await giftRecord(gift.id,db))?.state!=='active')throw new Error('gift_unavailable');
        }
        // Access is already active: a classification retry never revokes or delays it.
        await syncGiftRecipient(gift,{env,fetcher});
      }else{
        const content=giftEmailContent(job.kind,order,gift,{env});
        // A network timeout after send is ambiguous: mark for review, never blindly resend.
        const response=await fetcher('https://api.mailersend.com/v1/email',{method:'POST',headers:{Authorization:`Bearer ${env.MAILERSEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:{email:env.DELTA_GIFTS_EMAIL_FROM,name:'Sonny Court'},to:[{email:job.kind==='owner_email'?order.buyer_email:gift.recipient_email}],...content}),signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error(`email_${response.status}`);
      }
      await giftDb(lease,{...db,method:'PATCH',body:{state:'done',completed_at:new Date().toISOString(),last_error:null,lock_token:null}});
      completed++;
    }catch(error){
      const code=/^(circle_\w+|gift_\w+|email_\d+|not_ready)$/.test(error.message)?error.message:'provider_unconfirmed';
      const retry=job.kind==='activate' && job.attempts<5 && code!=='gift_unavailable';
      await giftDb(lease,{...db,method:'PATCH',body:{state:retry?'pending':'failed',last_error:code,run_at:new Date(Date.now()+120000*Math.max(1,job.attempts)).toISOString(),lock_token:null}});
      failed++;
    }
  }
  return {enabled:true,processed:jobs?.length || 0,completed,failed};
}
