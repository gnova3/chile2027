-- Run once in a dedicated Supabase project. No personal data belongs in Git.
begin;
create schema if not exists trip_private;
revoke all on schema trip_private from public, anon, authenticated;
create table trip_private.admins(user_id uuid primary key references auth.users(id));
create table trip_private.requests(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 100), email text not null check(length(email)<=254 and email like '%@%.%'),
 title text not null check(length(title) between 1 and 140), message text not null default '' check(length(message)<=2000),
 city text not null check(length(city) between 1 and 100), category text not null check(category in ('friends','work','explore','travel','personal')),
 starts_at timestamptz not null, ends_at timestamptz not null, status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 created_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table trip_private.events(
 id uuid primary key default gen_random_uuid(), request_id uuid unique references trip_private.requests(id),
 title_en text not null check(length(title_en) between 1 and 140), title_es text not null check(length(title_es) between 1 and 140),
 city text not null check(length(city) between 1 and 100), category text not null check(category in ('friends','work','explore','travel','personal')),
 starts_at timestamptz not null, ends_at timestamptz not null, status text not null default 'active' check(status in ('active','cancelled')),
 check(ends_at>starts_at)
);
create table trip_private.ideas(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 100),email text not null check(length(email)<=254 and email like '%@%.%'),
 title text not null check(length(title) between 1 and 140),description text not null check(length(description) between 1 and 2000),
 title_en text not null default '',title_es text not null default '',description_en text not null default '',description_es text not null default '',
 published boolean not null default false,poll_open boolean not null default false,poll_started boolean not null default false,created_at timestamptz not null default now()
);
create table trip_private.votes(
 idea_id uuid references trip_private.ideas(id) not null,owner_id uuid references auth.users(id) not null,
 choice text not null check(choice in ('yes','maybe','no')),primary key(idea_id,owner_id)
);
create table trip_private.photos(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),path text unique not null,
 caption text not null check(length(caption) between 1 and 240),status text not null default 'uploading' check(status in ('uploading','pending','approved','rejected')),
 created_at timestamptz not null default now()
);
create table trip_private.submissions(owner_id uuid references auth.users(id) not null,created_at timestamptz not null default now());
create index submissions_owner_date on trip_private.submissions(owner_id,created_at);
-- Defence in depth: tables are outside exposed schemas, grants revoked, RLS enabled.
alter table trip_private.admins enable row level security;
alter table trip_private.requests enable row level security;
alter table trip_private.events enable row level security;
alter table trip_private.ideas enable row level security;
alter table trip_private.votes enable row level security;
alter table trip_private.photos enable row level security;
alter table trip_private.submissions enable row level security;
revoke all on all tables in schema trip_private from public,anon,authenticated;
create function public.is_trip_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from trip_private.admins where user_id=auth.uid())
$$;
create function trip_private.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin if not public.is_trip_admin() then raise exception 'ADMIN_REQUIRED';end if;end $$;
create function trip_private.limit_submission() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from trip_private.submissions where owner_id=auth.uid() and created_at>now()-interval '24 hours')>=20 then raise exception 'RATE_LIMIT';end if;
 insert into trip_private.submissions(owner_id) values(auth.uid());
end $$;
create function trip_private.check_time(a timestamptz,b timestamptz) returns void language plpgsql set search_path='' as $$
begin
 if a is null or b is null or a<'2027-01-17 00:00 America/Santiago'::timestamptz or b>'2027-02-09 00:00 America/Santiago'::timestamptz or b<a+interval '15 minutes' or b>a+interval '8 hours' then raise exception 'INVALID_TIME';end if;
end $$;
create function public.public_data() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title_en',title_en,'title_es',title_es,'city',city,'category',category,'starts_at',starts_at,'ends_at',ends_at) order by starts_at) from trip_private.events where status='active'),'[]'::jsonb),
 'plans',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'title_en',i.title_en,'title_es',i.title_es,'description_en',i.description_en,'description_es',i.description_es,'poll_open',i.poll_open,'poll_started',i.poll_started,'votes',jsonb_build_object('yes',(select count(*) from trip_private.votes v where v.idea_id=i.id and choice='yes'),'maybe',(select count(*) from trip_private.votes v where v.idea_id=i.id and choice='maybe'),'no',(select count(*) from trip_private.votes v where v.idea_id=i.id and choice='no'))) order by i.created_at) from trip_private.ideas i where published),'[]'::jsonb),
 'photos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'path',path,'caption',caption) order by created_at desc) from trip_private.photos where status='approved'),'[]'::jsonb))
$$;
create function public.submit_request(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;a timestamptz=(p->>'starts_at')::timestamptz;b timestamptz=(p->>'ends_at')::timestamptz;
begin
 perform trip_private.limit_submission();perform trip_private.check_time(a,b);
 if exists(select 1 from trip_private.events where status='active' and starts_at<b and ends_at>a) then raise exception 'CONFLICT';end if;
 insert into trip_private.requests(owner_id,name,email,title,message,city,category,starts_at,ends_at) values(auth.uid(),trim(p->>'name'),trim(p->>'email'),trim(p->>'title'),coalesce(p->>'message',''),trim(p->>'city'),p->>'category',a,b) returning id into result;return result;
end $$;
create function public.submit_idea(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin perform trip_private.limit_submission();insert into trip_private.ideas(owner_id,name,email,title,description) values(auth.uid(),trim(p->>'name'),trim(p->>'email'),trim(p->>'title'),trim(p->>'description')) returning id into result;return result;end $$;
create function public.admin_data() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform trip_private.require_admin();return jsonb_build_object(
 'requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from trip_private.requests r),'[]'::jsonb),
 'ideas',coalesce((select jsonb_agg(to_jsonb(i) order by created_at desc) from trip_private.ideas i),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by starts_at) from trip_private.events e),'[]'::jsonb),
 'photos',coalesce((select jsonb_agg(to_jsonb(f) order by created_at desc) from trip_private.photos f where status<>'uploading'),'[]'::jsonb));end $$;
create function public.save_event(p jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid=(p->>'id')::uuid;rid uuid=(p->>'request_id')::uuid;a timestamptz=(p->>'starts_at')::timestamptz;b timestamptz=(p->>'ends_at')::timestamptz;
begin
 perform trip_private.require_admin();perform trip_private.check_time(a,b);perform pg_advisory_xact_lock(20270117);
 if exists(select 1 from trip_private.events where status='active' and starts_at<b and ends_at>a and id is distinct from result) then raise exception 'CONFLICT';end if;
 if rid is not null and not exists(select 1 from trip_private.requests where id=rid and status='pending') then raise exception 'INVALID_REQUEST';end if;
 if result is null then insert into trip_private.events(request_id,title_en,title_es,city,category,starts_at,ends_at) values(rid,trim(p->>'title_en'),trim(p->>'title_es'),trim(p->>'city'),p->>'category',a,b) returning id into result;
 else update trip_private.events set title_en=trim(p->>'title_en'),title_es=trim(p->>'title_es'),city=trim(p->>'city'),category=p->>'category',starts_at=a,ends_at=b where id=result and status='active';if not found then raise exception 'NOT_FOUND';end if;end if;
 if rid is not null then update trip_private.requests set status='approved' where id=rid;end if;return result;
end $$;
create function public.reject_request(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin perform trip_private.require_admin();update trip_private.requests set status='rejected' where id=(p->>'id')::uuid and status='pending';if not found then raise exception 'NOT_FOUND';end if;end $$;
create function public.cancel_event(p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin perform trip_private.require_admin();perform pg_advisory_xact_lock(20270117);update trip_private.events set status='cancelled' where id=(p->>'id')::uuid returning request_id into rid;if not found then raise exception 'NOT_FOUND';end if;update trip_private.requests set status='cancelled' where id=rid;end $$;
create function public.manage_idea(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin perform trip_private.require_admin();
 if coalesce(length(trim(p->>'title_en')),0) not between 1 and 140 or coalesce(length(trim(p->>'title_es')),0) not between 1 and 140 or coalesce(length(trim(p->>'description_en')),0) not between 1 and 2000 or coalesce(length(trim(p->>'description_es')),0) not between 1 and 2000 then raise exception 'INVALID_PLAN';end if;
 update trip_private.ideas set title_en=trim(p->>'title_en'),title_es=trim(p->>'title_es'),description_en=trim(p->>'description_en'),description_es=trim(p->>'description_es'),published=coalesce((p->>'published')::boolean,false),poll_open=coalesce((p->>'published')::boolean,false) and coalesce((p->>'poll_open')::boolean,false),poll_started=poll_started or (coalesce((p->>'published')::boolean,false) and coalesce((p->>'poll_open')::boolean,false)) where id=(p->>'id')::uuid;if not found then raise exception 'NOT_FOUND';end if;
end $$;
create function public.cast_vote(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 perform 1 from trip_private.ideas where id=(p->>'id')::uuid and published and poll_open for share;if not found then raise exception 'POLL_CLOSED';end if;
 insert into trip_private.votes(idea_id,owner_id,choice) values((p->>'id')::uuid,auth.uid(),p->>'choice') on conflict(idea_id,owner_id) do update set choice=excluded.choice;
end $$;
create function public.reserve_photo(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result uuid=gen_random_uuid();object_path text;
begin perform trip_private.limit_submission();
 -- Hard app-wide cap protects the free storage allowance (300 x 2 MB maximum).
 perform pg_advisory_xact_lock(20270118);
 if (select count(*) from trip_private.photos)>=300 then raise exception 'RATE_LIMIT';end if;
 object_path=result::text||'.jpg';insert into trip_private.photos(id,owner_id,path,caption) values(result,auth.uid(),object_path,trim(p->>'caption'));return jsonb_build_object('id',result,'path',object_path);end $$;
create function public.finish_photo(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin update trip_private.photos f set status='pending' where f.id=(p->>'id')::uuid and f.owner_id=auth.uid() and f.status='uploading' and exists(select 1 from storage.objects o where o.bucket_id='trip-photos' and o.name=f.path);if not found then raise exception 'PHOTO_NOT_UPLOADED';end if;end $$;
create function public.moderate_photo(p jsonb) returns void language plpgsql security definer set search_path='' as $$
begin perform trip_private.require_admin();if p->>'status' not in ('approved','rejected') then raise exception 'INVALID_STATUS';end if;update trip_private.photos set status=p->>'status' where id=(p->>'id')::uuid and status<>'uploading';if not found then raise exception 'NOT_FOUND';end if;end $$;
create function public.can_upload_trip_photo(object_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from trip_private.photos where path=object_path and owner_id=auth.uid() and status='uploading')
$$;
create function public.can_read_trip_photo(object_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_trip_admin() or exists(select 1 from trip_private.photos where path=object_path and status='approved')
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('trip-photos','trip-photos',false,2097152,array['image/jpeg']);
create policy trip_photo_upload on storage.objects for insert to authenticated with check(bucket_id='trip-photos' and public.can_upload_trip_photo(name));
create policy trip_photo_read on storage.objects for select to anon,authenticated using(bucket_id='trip-photos' and public.can_read_trip_photo(name));
-- Explicitly opt in to function execution. Never grant schema/table access to visitors.
revoke all on all functions in schema trip_private from public,anon,authenticated;
revoke all on function public.is_trip_admin(),public.public_data(),public.submit_request(jsonb),public.submit_idea(jsonb),public.admin_data(),public.save_event(jsonb),public.reject_request(jsonb),public.cancel_event(jsonb),public.manage_idea(jsonb),public.cast_vote(jsonb),public.reserve_photo(jsonb),public.finish_photo(jsonb),public.moderate_photo(jsonb),public.can_upload_trip_photo(text),public.can_read_trip_photo(text) from public,anon,authenticated;
grant execute on function public.public_data(),public.can_read_trip_photo(text),public.is_trip_admin() to anon,authenticated;
grant execute on function public.submit_request(jsonb),public.submit_idea(jsonb),public.admin_data(),public.save_event(jsonb),public.reject_request(jsonb),public.cancel_event(jsonb),public.manage_idea(jsonb),public.cast_vote(jsonb),public.reserve_photo(jsonb),public.finish_photo(jsonb),public.moderate_photo(jsonb),public.can_upload_trip_photo(text) to authenticated;
commit;
