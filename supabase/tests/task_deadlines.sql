begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
  p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  base jsonb:='{"at":"2026-10-15T16:00:00Z","logicalDate":"2026-10-15","timezone":"America/New_York"}';
  invalid jsonb; failed boolean; completion timestamptz; n bigint; entry_data jsonb;
begin
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',legacy,'action','create','title','Legacy task','topic','life'));
  assert (select due_date is null and due_at is null from public.tasks where id=legacy),'Legacy deadline defaults failed';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','create','title','Essay','topic','school','estimatedMinutes',90,'highPriority',true,'deadline',jsonb_build_object('date','2026-10-16')));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','create','title','Outline','topic','school','parentId',p));
  assert (select due_date=date '2026-10-16' and due_at is null and estimated_minutes=90 and high_priority from public.tasks where id=p),'Root deadline creation failed';
  assert (select due_date is null and due_at is null from public.tasks where id=c),'Child inherited deadline';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','deadline',jsonb_build_object('at','2026-10-16T21:00:00.000Z')));
  assert (select due_date is null and due_at=timestamptz '2026-10-16T21:00:00Z' from public.tasks where id=p),'Timed switch did not clear date';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','complete','completed',true,'recordDaily',true));
  select completed_at into completion from public.tasks where id=p;
  select count(*) into n from public.task_events where task_id in(p,c);
  select data into entry_data from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-15';
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',p,'action','options','deadline',jsonb_build_object('date','2026-10-17')));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','deadline',jsonb_build_object('date','2026-10-18')));
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',p,'action','options','deadline',jsonb_build_object('date','2026-10-17')));
  assert (select due_date=date '2026-10-18' and due_at is null and completed_at=completion and high_priority and estimated_minutes=90 from public.tasks where id=p),'Retry replaced newer deadline or completion/options';
  assert (select count(*) from public.task_events where task_id in(p,c))=n,'Deadline edit created history';
  assert (select data=entry_data from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-15'),'Deadline edit changed daily work';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','rename','title','Renamed essay'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','estimatedMinutes',30));
  assert (select due_date=date '2026-10-18' from public.tasks where id=p),'Older client metadata erased deadline';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','deadline',null));
  assert (select due_date is null and due_at is null and completed_at=completion from public.tasks where id=p),'Deadline removal changed completion';
  foreach invalid in array array[
    '{}'::jsonb,'[]'::jsonb,'true'::jsonb,'"2026-10-18"'::jsonb,
    '{"date":"2026-02-30"}'::jsonb,'{"date":"2026-2-01"}'::jsonb,'{"date":null}'::jsonb,
    '{"at":"infinity"}'::jsonb,'{"at":"2026-10-16T25:00:00.000Z"}'::jsonb,'{"at":"2026-10-16T21:00:00-04:00"}'::jsonb,
    '{"date":"2026-10-18","extra":true}'::jsonb,'{"date":"2026-10-18","at":"2026-10-16T21:00:00.000Z"}'::jsonb
  ] loop
    failed:=false;
    begin perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','deadline',invalid));
    exception when others then failed:=true; end;
    assert failed,'Invalid deadline accepted';
  end loop;
  failed:=false;
  begin perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','options','deadline',jsonb_build_object('date','2026-10-18')));
  exception when others then failed:=true; end;
  assert failed,'Child deadline update accepted';
  failed:=false;
  begin perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',gen_random_uuid(),'action','create','title','Invalid child','topic','school','parentId',p,'deadline',jsonb_build_object('date','2026-10-18')));
  exception when others then failed:=true; end;
  assert failed,'Child deadline creation accepted';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','options','deadline',null));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','delete'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','deadline',jsonb_build_object('date','2026-10-18')));
  assert (select deleted_at is not null and due_date is null from public.tasks where id=p),'Deadline edit resurrected deleted task';
end; $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ declare failed boolean:=false; n integer;
begin
  assert (select count(*) from public.tasks)=0,'Foreign account reads deadlines';
  update public.tasks set due_date='2026-10-18'; get diagnostics n=row_count;
  assert n=0,'Foreign account updates deadlines';
  begin perform public.apply_task_operation(gen_random_uuid(),jsonb_build_object('taskId',gen_random_uuid(),'action','options','deadline',null));
  exception when insufficient_privilege then failed:=true; end;
  assert failed,'Foreign account invokes deadline RPC';
end; $$;
rollback;
select 'PASS: root deadlines, type changes, clearing, validation, retries, legacy commands, daily/history preservation and ownership' as result;
