import {createHash} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {parsePhoneNumberFromString} from 'libphonenumber-js/max';

export function normalizeStopPhone(value) {
  if(typeof value!=='string'||value.length>60)return '';
  const raw=value.trim().replace(/^00/,'+');
  if(!raw.startsWith('+'))return '';
  const parsed=parsePhoneNumberFromString(raw);
  return parsed?.isValid()?parsed.number:'';
}
const store=()=>getStore({name:'reconquete-sms-suppression',consistency:'strong'});
const key=phone=>createHash('sha256').update(phone).digest('hex');
export function makeSmsStopService({get=k=>store().get(k,{type:'json'}),set=(k,v)=>store().setJSON(k,v)}={}){
  return {
    async unsubscribe(value,confirmed){
      const phone=normalizeStopPhone(value);
      if(!phone||confirmed!==true)return {status:400,data:{error:'Saisis ton numéro avec son indicatif (ex. +33 ou +41), puis confirme.'}};
      await set(key(phone),{unsubscribed:true,at:new Date().toISOString(),scope:'reconquete'});
      return {status:200,data:{ok:true}};
    },
    async isBlocked(value){
      const phone=normalizeStopPhone(value);
      if(!phone)throw new Error('invalid_phone');
      return (await get(key(phone)))?.unsubscribed===true;
    },
  };
}
