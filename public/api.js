import {config} from './config.js';
export const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl) && !!config.publishableKey;
let session;
try {session=JSON.parse(sessionStorage.getItem('chile-session')||'null')} catch {session=null}
let refreshing;
function save(s) {session=s?{...s,expires_at:Date.now()+s.expires_in*1000}:null; if(session) sessionStorage.setItem('chile-session',JSON.stringify(session)); else sessionStorage.removeItem('chile-session')}
async function request(path, {body,method='POST',token,headers={},raw=false}={}) {
  if(!configured) throw new Error('NOT_CONNECTED');
  const response=await fetch(config.supabaseUrl+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:`Bearer ${token}`} : {}),...(!raw?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:raw?body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.message||data.msg||data.error_description||data.error||'Request failed');
  return data;
}
async function token(create=false) {
  if(session && session.expires_at<Date.now()+60000) {
    if(!refreshing) refreshing=request('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}}).then(save).catch(e=>{save(null);throw e}).finally(()=>refreshing=null);
    await refreshing;
  }
  if(!session && create) save(await request('/auth/v1/signup',{body:{data:{}}}));
  return session?.access_token;
}
export async function rpc(name,payload,privateCall=false) {return request('/rest/v1/rpc/'+name,{body:payload===undefined?{}:{p:payload},token:await token(privateCall)})}
export async function login(email,password) {save(await request('/auth/v1/token?grant_type=password',{body:{email,password}}))}
export async function logout() {try {if(session) await request('/auth/v1/logout',{token:await token()})} finally {save(null)}}
export async function photoUrl(path) {
  const result=await request('/storage/v1/object/sign/trip-photos/'+path,{body:{expiresIn:600},token:await token()});
  return config.supabaseUrl+'/storage/v1'+result.signedURL;
}
export async function uploadPhoto(file,caption) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024) throw new Error('PHOTO_FORMAT');
  const bitmap=await createImageBitmap(file);
  const ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));
  if(!blob||blob.size>2*1024*1024) throw new Error('PHOTO_SIZE');
  const photo=await rpc('reserve_photo',{caption},true);
  await request('/storage/v1/object/trip-photos/'+photo.path,{body:blob,raw:true,token:await token(true),headers:{'Content-Type':'image/jpeg','x-upsert':'false'}});
  await rpc('finish_photo',{id:photo.id},true);
}
