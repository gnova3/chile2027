import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const admin='00000000-0000-0000-0000-000000000001',guest='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
let db;
async function as(role,uid,fn){await db.exec(`set role ${role}; select set_config('test.uid','${uid||''}',false)`);try{return await fn()}finally{await db.exec('reset role')}}
async function rpc(name,p){const args=p===undefined?'':"$1::jsonb";return (await db.query(`select public.${name}(${args}) as result`,p===undefined?[]:[JSON.stringify(p)])).rows[0].result}
const meeting={name:'Private Person',email:'secret@example.com',title:'Coffee',message:'Private address 123',city:'Santiago',category:'friends',starts_at:'2027-01-20T15:00:00Z',ends_at:'2027-01-20T16:00:00Z'};
const event={title_en:'Coffee',title_es:'Café',city:'Santiago',category:'friends',starts_at:meeting.starts_at,ends_at:meeting.ends_at};
test('Database privacy and moderation integration',async t=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);insert into auth.users values('${admin}'),('${guest}'),('${other}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 await db.query('insert into trip_private.admins values($1)',[admin]);
 let requestId,ideaId,photo,eventId;
 await t.test('Guests can submit but cannot read private tables or admin dashboard',async()=>{
 requestId=await as('authenticated',guest,()=>rpc('submit_request',meeting));
 await as('authenticated',guest,async()=>{await assert.rejects(()=>rpc('admin_data'),/ADMIN_REQUIRED/);await assert.rejects(()=>db.query('select * from trip_private.requests'),/permission denied/);await assert.rejects(()=>rpc('save_event',event),/ADMIN_REQUIRED/)});
 await as('anon',null,async()=>{await assert.rejects(()=>rpc('submit_request',meeting),/permission denied/);const result=await rpc('public_data');assert.deepEqual(result.events,[]);assert(!JSON.stringify(result).includes('secret@example.com'))});
 });
 await t.test('Only an administrator approves; public fields exclude private details',async()=>{
 eventId=await as('authenticated',admin,()=>rpc('save_event',{...event,request_id:requestId}));
 const result=await as('anon',null,()=>rpc('public_data'));assert.equal(result.events.length,1);assert.equal(result.events[0].title_es,'Café');assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('Private'));assert(!JSON.stringify(result).includes('owner_id'));assert(!JSON.stringify(result).includes('request_id'));
 });
 await t.test('Overlaps and invalid intervals fail on the server',async()=>{
 await as('authenticated',admin,async()=>{await assert.rejects(()=>rpc('save_event',event),/CONFLICT/);await assert.rejects(()=>rpc('save_event',{...event,starts_at:'2026-01-01T00:00Z'}),/INVALID_TIME/)});
 await as('authenticated',other,()=>assert.rejects(()=>rpc('submit_request',meeting),/CONFLICT/));
 });
 await t.test('Ideas stay private until published; polls enforce open state and one vote per identity',async()=>{
 ideaId=await as('authenticated',guest,()=>rpc('submit_idea',{name:'Secret name',email:'secret@example.com',title:'Beach day',description:'A day by the sea'}));
 assert.deepEqual((await as('anon',null,()=>rpc('public_data'))).plans,[]);
 await as('authenticated',guest,()=>assert.rejects(()=>rpc('cast_vote',{id:ideaId,choice:'yes'}),/POLL_CLOSED/));
 const plan={id:ideaId,title_en:'Beach day',title_es:'Día de playa',description_en:'A day by the sea',description_es:'Un día junto al mar',published:true,poll_open:true};
 await as('authenticated',admin,()=>rpc('manage_idea',plan));
 await as('authenticated',guest,async()=>{await rpc('cast_vote',{id:ideaId,choice:'yes'});await rpc('cast_vote',{id:ideaId,choice:'maybe'})});
 const pub=(await as('anon',null,()=>rpc('public_data'))).plans[0];assert.deepEqual(pub.votes,{yes:0,maybe:1,no:0});assert(!JSON.stringify(pub).includes('secret'));
 await as('authenticated',admin,()=>rpc('manage_idea',{...plan,poll_open:false}));await as('authenticated',guest,()=>assert.rejects(()=>rpc('cast_vote',{id:ideaId,choice:'no'}),/POLL_CLOSED/));
 await as('authenticated',admin,()=>rpc('manage_idea',{...plan,published:false}));assert.equal((await as('anon',null,()=>rpc('public_data'))).plans.length,0);
 });
 await t.test('Photo storage denies unreserved uploads and unapproved reads, including by other guests',async()=>{
 photo=await as('authenticated',guest,()=>rpc('reserve_photo',{caption:'Andes'}));
 await as('authenticated',other,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('trip-photos',$1)",[photo.path]),/row-level security/));
 await as('authenticated',guest,async()=>{await assert.rejects(()=>rpc('finish_photo',{id:photo.id}),/PHOTO_NOT_UPLOADED/);await db.query("insert into storage.objects(bucket_id,name) values('trip-photos',$1)",[photo.path]);await rpc('finish_photo',{id:photo.id});await assert.rejects(()=>rpc('moderate_photo',{id:photo.id,status:'approved'}),/ADMIN_REQUIRED/)});
 assert.equal((await as('anon',null,()=>db.query('select * from storage.objects'))).rows.length,0);
 assert.equal((await as('authenticated',other,()=>db.query('select * from storage.objects'))).rows.length,0);
 assert.equal((await as('anon',null,()=>rpc('public_data'))).photos.length,0);
 await as('authenticated',admin,()=>rpc('moderate_photo',{id:photo.id,status:'approved'}));assert.equal((await as('anon',null,()=>db.query('select * from storage.objects'))).rows.length,1);
 await as('authenticated',guest,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('trip-photos',$1)",[photo.path]),/row-level security/));
 await as('authenticated',admin,()=>rpc('moderate_photo',{id:photo.id,status:'rejected'}));assert.equal((await as('anon',null,()=>db.query('select * from storage.objects'))).rows.length,0);
 });
 await t.test('Cancelling an activity removes it from the public schedule',async()=>{await as('authenticated',admin,()=>rpc('cancel_event',{id:eventId}));assert.equal((await as('anon',null,()=>rpc('public_data'))).events.length,0)});
 await t.test('Submission rate limits are enforced in the database',async()=>{await as('authenticated',other,async()=>{for(let i=0;i<20;i++) await rpc('submit_idea',{name:'N',email:'a@b.co',title:'Plan',description:'Idea'});await assert.rejects(()=>rpc('submit_idea',{name:'N',email:'a@b.co',title:'Plan',description:'Idea'}),/RATE_LIMIT/)})});
 await db.close();
});
