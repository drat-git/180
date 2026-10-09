-- All fixtures and changes are rolled back, including the temporary auth identity.
begin;
do $$
begin
  if not exists(select 1 from public.app_owner) then
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(gen_random_uuid(),'dratgit@gmail.com','{"provider":"email","providers":["email"]}','{}',now(),now());
  end if;
end; $$;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare d date:='2026-10-09'; a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); photo uuid:=gen_random_uuid(); result jsonb; before_revision bigint; failed boolean:=false;
begin
  select revision into before_revision from public.daily_entries where user_id=auth.uid() and logical_date=d;
  before_revision:=coalesce(before_revision,0);
  perform public.apply_entry_patch(d,a,'{"meal1Status":false,"meal1Reason":"Test: no groceries"}','America/New_York');
  perform public.apply_entry_patch(d,b,'{"journalText":"Test: device B journal"}','America/New_York');
  result:=public.apply_entry_patch(d,c,'{"meal1Status":true}','America/New_York');
  assert result->'data'->>'journalText'='Test: device B journal','Different-field merge failed';
  assert result->'data'->>'meal1Reason'='Test: no groceries','Reason preservation failed';
  assert result->'data'->>'meal1Status'='true','Latest field edit failed';
  result:=public.apply_entry_patch(d,a,'{"meal1Status":false,"meal1Reason":"Test: no groceries"}','America/New_York');
  assert (result->>'revision')::bigint=before_revision+3,'Replay incremented revision';
  assert result->'data'->>'meal1Status'='true','Retry overwrote a later edit';
  result:=public.apply_entry_patch(d,gen_random_uuid(),'{"cannabisUseDescriptions":["First use","Second use",""]}','America/New_York');
  assert result->'data'->'cannabisUseDescriptions'='["First use","Second use",""]'::jsonb,'Use descriptions were not saved';
  begin perform public.apply_entry_patch(d,gen_random_uuid(),'{"cannabisUseDescriptions":[1]}','America/New_York');exception when others then failed:=true;end;
  assert failed,'Non-string use description accepted';failed:=false;
  begin perform public.apply_entry_patch(d,gen_random_uuid(),'{"meal1Status":"yes"}','America/New_York');exception when others then failed:=true;end;
  assert failed,'Invalid answer was accepted';failed:=false;
  begin perform public.apply_entry_patch(d,gen_random_uuid(),'{"cannabisCount":-1}','America/New_York');exception when others then failed:=true;end;
  assert failed,'Negative count accepted';failed:=false;
  begin perform public.apply_entry_patch(current_date+2,gen_random_uuid(),'{}','America/New_York');exception when others then failed:=true;end;
  assert failed,'Future date accepted';failed:=false;
  begin perform public.apply_entry_patch(d,gen_random_uuid(),'{}','Not/A/Timezone');exception when others then failed:=true;end;
  assert failed,'Invalid timezone accepted';
  perform public.apply_image_operation(d,gen_random_uuid(),photo,1,false,'America/New_York');
  result:=public.apply_image_operation(d,gen_random_uuid(),photo,1,true,'America/New_York');
  assert result->>'deleted_at' is not null,'Photo deletion not recorded';
  result:=public.apply_image_operation(d,gen_random_uuid(),photo,1,false,'America/New_York');
  assert result->>'deleted_at' is not null,'Old add resurrected a deleted photo';
  assert not has_function_privilege('authenticated',(select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on p.pronamespace=n.oid where n.nspname='private' and p.proname='assign_app_owner'),'execute'),'Owner assignment is publicly callable';
  insert into storage.objects(bucket_id,name) values('journal',auth.uid()::text||'/2026-10-09/test.jpg');
  failed:=false;
  begin insert into storage.objects(bucket_id,name) values('journal','00000000-0000-0000-0000-000000000001/2026-10-09/foreign.jpg');exception when insufficient_privilege then failed:=true;end;
  assert failed,'Upload outside owned storage folder succeeded';
end; $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$
declare failed boolean:=false; n integer;
begin
  assert (select count(*) from public.daily_entries)=0,'Other user can see records';
  assert (select count(*) from public.journal_images)=0,'Other user can see image metadata';
  assert (select count(*) from storage.objects where bucket_id='journal')=0,'Other user can see photos';
  update public.daily_entries set data='{}';get diagnostics n=row_count;assert n=0,'Other user can modify records';
  begin perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),'{}','America/New_York');exception when insufficient_privilege then failed:=true;end;
  assert failed,'Other user can invoke write RPC';
end; $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare failed boolean:=false;
begin
  begin perform 1 from public.daily_entries;exception when insufficient_privilege then failed:=true;end;
  assert failed,'Anonymous access allowed';failed:=false;
  begin perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),'{}','America/New_York');exception when insufficient_privilege then failed:=true;end;
  assert failed,'Anonymous write RPC allowed';
end; $$;
reset role;
do $$
declare failed boolean:=false;
begin
  begin insert into auth.users(id,email) values(gen_random_uuid(),'outsider@example.invalid');exception when insufficient_privilege then failed:=true;end;
  assert failed,'Public account registration was not blocked';
end; $$;
rollback;
select 'PASS: field merge, latest edit, idempotency, validation, photo tombstones, owner isolation, storage isolation, registration gate' as result;
