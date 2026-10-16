begin;
update private.registration_settings set enabled=true;
-- Synthetic accounts; all rows are rolled back.
insert into auth.users(id,email,created_at,raw_user_meta_data) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','public-a@example.invalid','2026-10-15T05:00:00Z','{"signup_timezone":"America/New_York"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','public-b@example.invalid','2026-10-15T06:00:00Z','{"signup_timezone":"America/New_York"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','public-c@example.invalid','2026-10-15T12:00:00Z','{"signup_timezone":"not-a-timezone"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','public-d@example.invalid','2026-10-15T12:00:00Z','{}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','public-e@example.invalid','2026-10-15T12:00:00Z','{}');
do $$ begin
 assert (select start_date=date '2026-10-14' from public.account_profiles where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),'Before-2-AM signup anchor wrong';
 assert (select start_date=date '2026-10-15' from public.account_profiles where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'),'2-AM signup anchor wrong';
 assert (select signup_timezone='UTC' from public.account_profiles where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),'Invalid timezone did not fall back to UTC';
 assert (select legacy and start_date=date '2026-10-09' from public.account_profiles where user_id=(select user_id from public.app_owner)),'Owner history anchor changed';
end; $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare failed boolean:=false; begin
 assert (select count(*)=1 from public.account_profiles),'Profile leaked another account';
 begin update public.account_profiles set start_date=date '2020-01-01'; exception when insufficient_privilege then failed:=true; end; assert failed,'Profile fields writable';
 failed:=false; begin perform public.apply_entry_patch('2026-10-15',gen_random_uuid(),'{}','UTC'); exception when insufficient_privilege then failed:=true; end; assert failed,'Unfinished account could write';
 failed:=false; begin perform public.complete_onboarding(gen_random_uuid(),'student',1,'{"items":["missing"],"lists":[],"tasks":[],"activities":[]}'); exception when others then failed:=true; end; assert failed,'Unknown catalog entry accepted';
 assert not exists(select 1 from public.tasks),'Invalid setup left tasks';
end; $$;
reset role;
-- Exercise all catalog variants through the real initializer and frozen baseline.
do $$ declare template record; selection jsonb; uid uuid; response jsonb; op uuid; n integer:=0; begin
 for template in select * from private.starter_catalog order by case id when 'student' then 0 when 'everyday' then 1 when 'work' then 2 else 3 end loop
  n:=n+1; uid:=('aaaaaaaa-aaaa-4aaa-8aaa-'||'aaaaaaaaaaa'||n)::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  selection:=jsonb_build_object(
   'items',(select coalesce(jsonb_agg(e->>'id'),'[]') from jsonb_array_elements(template.data->'configuration'->'items') e),
   'lists',(select coalesce(jsonb_agg(e->>'id'),'[]') from jsonb_array_elements(template.data->'configuration'->'lists') e),
   'tasks',(select coalesce(jsonb_agg(e->>'id'),'[]') from jsonb_array_elements(template.data->'tasks') e),
   'activities',(select coalesce(jsonb_agg(e->>'id'),'[]') from jsonb_array_elements(template.data->'activities') e));
  op:=gen_random_uuid(); response:=public.complete_onboarding(op,template.id,template.version,selection);
  assert response->'initial_configuration'=template.data->'configuration','Frozen starter differs from catalog';
  assert (select count(*)=jsonb_array_length(template.data->'tasks') from public.tasks where user_id=uid),'Starter tasks incorrect';
  assert (select count(*)=jsonb_array_length(template.data->'activities') from public.anti_rotting_items where user_id=uid),'Starter activities incorrect';
  assert not exists(select 1 from public.tasks where user_id=uid and completed_at is not null),'Starter tasks already completed';
  assert not exists(select 1 from public.daily_entries where user_id=uid) and not exists(select 1 from public.custom_answers where user_id=uid) and not exists(select 1 from public.task_events where user_id=uid) and not exists(select 1 from public.anti_rotting_logs where user_id=uid),'Setup invented daily history';
  assert public.complete_onboarding(op,'blank',1,'{}')=response,'Lost acknowledgement reseeded setup';
  assert public.complete_onboarding(gen_random_uuid(),'blank',1,'{}')=response,'Competing device reseeded setup';
 end loop;
 perform set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5","role":"authenticated"}',true);
 response:=public.complete_onboarding(gen_random_uuid(),'everyday',1,'{"items":[],"lists":[],"tasks":[],"activities":[]}');
 assert response->'initial_configuration'='{"blocks":[],"items":[],"lists":[]}'::jsonb,'All-off setup not empty';
end; $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}',true);
set local role authenticated;
do $$ declare task uuid; op uuid:=gen_random_uuid(); day date; result jsonb; failed boolean:=false; begin
 assert (select count(*)=3 from public.tasks),'Foreign tasks visible';
 assert (select count(*)=1 from public.account_profiles),'Foreign profiles visible after setup';
 assert jsonb_array_length(public.customization_config_at('2026-10-15')->'items')=6,'Own baseline not resolved';
 perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','starter-move',1,'{"value":true}');
 select id into task from public.tasks where topic='starter-school' limit 1;
 day:=greatest(public.account_start_date(),((clock_timestamp() at time zone 'UTC')-interval '2 hours')::date);
 result:=public.apply_task_operation(op,jsonb_build_object('taskId',task,'action','complete','completed',true,'at',clock_timestamp(),'logicalDate',day,'timezone','UTC','checklistLink',jsonb_build_object('itemId','starter-school-work','generation',1,'listId','starter-school','configurationRevision',0)));
 assert result->'custom_answers'->0->'value'->'value'='true','New-account task completion failed to record linked work';
 failed:=false; begin perform public.apply_entry_patch('2026-10-13',gen_random_uuid(),'{}','UTC'); exception when others then failed:=true; end; assert failed,'Pre-account day accepted';
 failed:=false; begin perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-13','starter-move',1,'{"value":true}'); exception when others then failed:=true; end; assert failed,'Pre-account custom answer accepted';
 failed:=false; begin perform public.apply_task_operation(gen_random_uuid(),jsonb_build_object('taskId',gen_random_uuid(),'action','create','topic','school','title','Not my list','at',clock_timestamp(),'logicalDate',day,'timezone','UTC')); exception when others then failed:=true; end; assert failed,'Legacy topic bypassed new list membership';
 insert into storage.objects(bucket_id,name) values('journal',auth.uid()::text||'/2026-10-15/test.jpg');
 failed:=false; begin insert into storage.objects(bucket_id,name) values('journal','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2/2026-10-15/foreign.jpg'); exception when insufficient_privilege then failed:=true; end; assert failed,'Foreign photo upload accepted';
end; $$;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}',true);
do $$ begin
 assert (select count(*)=0 from public.custom_answers),'Foreign answers visible';
 assert (select count(*)=0 from public.task_events),'Foreign task events visible';
 assert (select count(*)=0 from storage.objects),'Foreign photos visible';
 assert (select count(*)=3 from public.tasks),'Own seeded tasks missing';
end; $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ declare failed boolean:=false; begin
 begin perform public.complete_onboarding(gen_random_uuid(),'blank',1,'{}'); exception when insufficient_privilege then failed:=true; end; assert failed,'Anonymous initialization accepted';
 failed:=false; begin perform 1 from public.account_profiles; exception when insufficient_privilege then failed:=true; end; assert failed,'Anonymous profile access accepted';
end; $$;
rollback;
select 'PASS: public profiles, dates, all starters, transactional setup, replay, linked work, independent accounts and storage isolation' as result;
