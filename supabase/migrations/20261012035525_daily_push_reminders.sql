-- Additive notification storage. No daily answers or task/history records change.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table public.push_installations (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 origin text not null, endpoint text not null unique, p256dh text not null, auth text not null,
 enabled boolean not null default false,
 reminder_time text not null default '21:00' check(reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 timezone text not null, next_send_at timestamptz not null,
 last_test_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index push_installations_due on public.push_installations(next_send_at) where enabled;
alter table public.push_installations enable row level security;
-- Only server functions manage endpoints/keys; owner identity is verified there.
revoke all on public.push_installations from public,anon,authenticated;
grant all on public.push_installations to service_role;
create table public.push_deliveries (
 installation_id uuid not null references public.push_installations(id) on delete cascade,
 logical_date date not null, status text not null default 'pending' check(status in ('pending','sent','expired','failed')),
 attempts integer not null default 0, lease_until timestamptz not null default now(), expires_at timestamptz not null,
 primary key(installation_id,logical_date)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public,anon,authenticated;
grant all on public.push_deliveries to service_role;
-- Secret contents are generated at setup/runtime, never placed in a migration.
do $$ begin
 if not exists(select 1 from vault.secrets where name='180_push_dispatch') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'180_push_dispatch');
 end if;
end; $$;
-- A narrow service-only RPC bridges Edge Functions to Vault. SECURITY DEFINER is
-- required for Vault access; role checks and revoked execution exclude clients.
create function public.push_backend_config(p_public text default null,p_private text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pub text; priv text; token text;
begin
 if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(1801209);
 if p_public is not null and not exists(select 1 from vault.secrets where name='180_push_public') then
  if p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Invalid push keys'; end if;
  perform vault.create_secret(p_public,'180_push_public');
  perform vault.create_secret(p_private,'180_push_private');
 end if;
 select decrypted_secret into pub from vault.decrypted_secrets where name='180_push_public';
 select decrypted_secret into priv from vault.decrypted_secrets where name='180_push_private';
 select decrypted_secret into token from vault.decrypted_secrets where name='180_push_dispatch';
 return jsonb_build_object('publicKey',pub,'privateKey',priv,'dispatchToken',token);
end; $$;
revoke all on function public.push_backend_config(text,text) from public,anon,authenticated;
grant execute on function public.push_backend_config(text,text) to service_role;
create function public.claim_push_delivery(p_installation uuid,p_day date,p_expires timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare claimed boolean;
begin
 if p_expires<=now() then return false; end if;
 insert into public.push_deliveries(installation_id,logical_date,attempts,lease_until,expires_at)
 values(p_installation,p_day,1,now()+interval '2 minutes',p_expires)
 on conflict(installation_id,logical_date) do update
 set attempts=public.push_deliveries.attempts+1,lease_until=now()+interval '2 minutes'
 where public.push_deliveries.status='pending' and public.push_deliveries.attempts<3 and public.push_deliveries.lease_until<=now()
 returning true into claimed;
 return coalesce(claimed,false);
end; $$;
revoke all on function public.claim_push_delivery(uuid,date,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_push_delivery(uuid,date,timestamptz) to service_role;
-- Exactly one shared scheduler, independent of either Vercel frontend project.
select cron.schedule('180-daily-reminders','* * * * *',$job$
 select net.http_post(
 url:='https://xlkmnczbuzmdfchoqqbr.supabase.co/functions/v1/send-reminders',
 headers:=jsonb_build_object('Content-Type','application/json','X-Reminder-Token',(select decrypted_secret from vault.decrypted_secrets where name='180_push_dispatch')),
 body:='{}'::jsonb, timeout_milliseconds:=20000
 );
$job$);
