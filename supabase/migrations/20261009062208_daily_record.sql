-- Private, single-owner application. Only an administrator can assign the owner.
create table public.app_owner (singleton boolean primary key default true check(singleton), user_id uuid not null unique references auth.users(id));
alter table public.app_owner enable row level security;
create policy owner_read on public.app_owner for select to authenticated using(user_id=(select auth.uid()));
grant select on public.app_owner to authenticated;

create function public.valid_daily_data(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(value) <> 'object' then return false; end if;
  for k,v in select * from jsonb_each(value) loop
    if k = any(array['meal1Status','meal2Status','snack1Status','snack2Status','shakeStatus','amPostureStatus','pmPostureStatus','liftedStatus','classAttendanceStatus','cannabisStatus','applicationsStatus']) then
      if jsonb_typeof(v) not in ('boolean','null') then return false; end if;
    elsif k = any(array['wakeReason','meal1Reason','meal2Reason','snack1Reason','snack2Reason','shakeReason','amPostureReason','pmPostureReason','liftedReason','classAttendanceReason','cannabisReason','applicationsReason','screenTimeReason','meal1Description','meal2Description','snack1Description','snack2Description','journalText']) then
      if jsonb_typeof(v) <> 'string' then return false; end if;
    elsif k='wakeTime' then
      if v <> 'null'::jsonb and (jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
    elsif k=any(array['cannabisCount','applicationsCount','screenTimeMinutes']) then
      if v <> 'null'::jsonb then
        if jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[0-9]+$' then return false; end if;
        if (v#>>'{}')::numeric > 2147483647 then return false; end if;
        if k='screenTimeMinutes' and (v#>>'{}')::numeric>1440 then return false; end if;
        if k<>'screenTimeMinutes' and (v#>>'{}')::numeric<1 then return false; end if;
      end if;
    else return false;
    end if;
  end loop;
  return true;
end; $$;

create table public.daily_entries (
  user_id uuid not null references auth.users(id), logical_date date not null check(logical_date>='2026-10-09'),
  data jsonb not null default '{}' check(public.valid_daily_data(data)), revision bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id,logical_date)
);
create table public.journal_images (
  id uuid primary key, user_id uuid not null, logical_date date not null, storage_path text not null,
  position integer not null check(position>=0), revision bigint not null default 1, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(user_id,logical_date) references public.daily_entries(user_id,logical_date),
  check(storage_path=user_id::text||'/'||logical_date::text||'/'||id::text||'.jpg')
);
create index journal_images_day on public.journal_images(user_id,logical_date);
create table public.operation_receipts (
  user_id uuid not null references auth.users(id), operation_id uuid not null, entity_key text not null,
  created_at timestamptz not null default now(), primary key(user_id,operation_id)
);
alter table public.daily_entries enable row level security;
alter table public.journal_images enable row level security;
alter table public.operation_receipts enable row level security;
create policy private_entries on public.daily_entries for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy private_images on public.journal_images for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy private_receipts on public.operation_receipts for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
grant select,insert,update on public.daily_entries,public.journal_images,public.operation_receipts to authenticated;
revoke all on public.daily_entries,public.journal_images,public.operation_receipts,public.app_owner from anon;

create function public.check_entry_access(p_date date,p_timezone text) returns void language plpgsql security invoker set search_path='' as $$
declare local_now timestamp;
begin
  if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise exception 'Private account required' using errcode='42501'; end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
  local_now:=clock_timestamp() at time zone p_timezone;
  if p_date is null or p_date<'2026-10-09' or p_date>(local_now::date - case when extract(hour from local_now)<2 then 1 else 0 end) then raise exception 'Date outside available days'; end if;
end; $$;

create function public.apply_entry_patch(p_date date,p_operation uuid,p_patch jsonb,p_timezone text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry public.daily_entries; receipt public.operation_receipts;
begin
  perform public.check_entry_access(p_date,p_timezone);
  if p_operation is null or p_patch is null or not public.valid_daily_data(p_patch) then raise exception 'Invalid patch'; end if;
  insert into public.daily_entries(user_id,logical_date) values(auth.uid(),p_date) on conflict do nothing;
  select * into entry from public.daily_entries where user_id=auth.uid() and logical_date=p_date for update;
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
  if found then
    if receipt.entity_key <> 'day:'||p_date::text then raise exception 'Operation ID reused'; end if;
    return to_jsonb(entry);
  end if;
  update public.daily_entries set data=data||p_patch,revision=revision+1,updated_at=clock_timestamp()
    where user_id=auth.uid() and logical_date=p_date returning * into entry;
  insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'day:'||p_date::text);
  return to_jsonb(entry);
end; $$;

create function public.apply_image_operation(p_date date,p_operation uuid,p_image uuid,p_position integer,p_delete boolean,p_timezone text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare image public.journal_images; receipt public.operation_receipts;
begin
  perform public.check_entry_access(p_date,p_timezone);
  if p_operation is null or p_image is null or p_position is null or p_position<0 or p_delete is null then raise exception 'Invalid image operation'; end if;
  insert into public.daily_entries(user_id,logical_date) values(auth.uid(),p_date) on conflict do nothing;
  perform 1 from public.daily_entries where user_id=auth.uid() and logical_date=p_date for update;
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
  if found then
    if receipt.entity_key <> 'image:'||p_image::text then raise exception 'Operation ID reused'; end if;
    select * into image from public.journal_images where id=p_image and user_id=auth.uid();return to_jsonb(image);
  end if;
  insert into public.journal_images(id,user_id,logical_date,storage_path,position,deleted_at)
    values(p_image,auth.uid(),p_date,auth.uid()::text||'/'||p_date::text||'/'||p_image::text||'.jpg',p_position,case when p_delete then clock_timestamp() end) on conflict(id) do nothing;
  select * into image from public.journal_images where id=p_image and user_id=auth.uid() and logical_date=p_date for update;
  if not found then raise exception 'Image ownership mismatch' using errcode='42501'; end if;
  -- Deletion is permanent for this image ID; an old add cannot resurrect it.
  if p_delete and image.deleted_at is null then
    update public.journal_images set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=revision+1 where id=p_image returning * into image;
  end if;
  insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'image:'||p_image::text);
  return to_jsonb(image);
end; $$;
revoke execute on function public.valid_daily_data(jsonb),public.check_entry_access(date,text),public.apply_entry_patch(date,uuid,jsonb,text),public.apply_image_operation(date,uuid,uuid,integer,boolean,text) from public,anon;
grant execute on function public.valid_daily_data(jsonb),public.check_entry_access(date,text),public.apply_entry_patch(date,uuid,jsonb,text),public.apply_image_operation(date,uuid,uuid,integer,boolean,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('journal','journal',false,10485760,array['image/jpeg']);
create policy journal_read on storage.objects for select to authenticated using(bucket_id='journal' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy journal_upload on storage.objects for insert to authenticated with check(bucket_id='journal' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy journal_remove on storage.objects for delete to authenticated using(bucket_id='journal' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
