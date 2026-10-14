begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
  p uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  base jsonb:='{"at":"2026-10-14T16:00:00Z","logicalDate":"2026-10-14","timezone":"America/New_York"}';
  invalid jsonb; failed boolean; completion timestamptz; n bigint;
begin
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',legacy,'action','create','title','Old client','topic','life'));
  assert (select estimated_minutes is null and not high_priority from public.tasks where id=legacy),'Legacy creation defaults failed';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','create','title','Essay','topic','school','estimatedMinutes',90,'highPriority',true));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','create','title','Outline','topic','school','parentId',p,'estimatedMinutes',20));
  assert (select estimated_minutes=90 and high_priority from public.tasks where id=p),'Creation options lost';
  assert (select estimated_minutes=20 and not high_priority from public.tasks where id=c),'Subtask duration lost';
  -- Metadata writes merge only their supplied fields, including an idempotent lost acknowledgement.
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',p,'action','options','estimatedMinutes',45));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','estimatedMinutes',60));
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',p,'action','options','estimatedMinutes',45));
  assert (select estimated_minutes=60 and high_priority from public.tasks where id=p),'Old retry replaced newer server options';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','highPriority',false));
  assert (select estimated_minutes=60 and not high_priority from public.tasks where id=p),'Priority patch replaced duration';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options','estimatedMinutes',null));
  assert (select estimated_minutes is null from public.tasks where id=p),'Estimate removal failed';
  -- A duration change never resets completion or produces another history event.
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','complete','completed',true));
  select completed_at into completion from public.tasks where id=p;
  select count(*) into n from public.task_events where task_id in (p,c);
  perform public.apply_task_operation(gen_random_uuid(),base||'{"at":"2026-10-14T17:00:00Z"}'||jsonb_build_object('taskId',c,'action','options','estimatedMinutes',30));
  perform public.apply_task_operation(gen_random_uuid(),base||'{"at":"2026-10-14T17:00:00Z"}'||jsonb_build_object('taskId',p,'action','options','highPriority',true));
  assert (select completed_at=completion from public.tasks where id=p),'Metadata reset parent expiry';
  assert (select completed_at=completion from public.tasks where id=c),'Metadata reset child expiry';
  assert (select count(*) from public.task_events where task_id in(p,c))=n,'Metadata created completion history';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','rename','title','Renamed essay'));
  assert (select high_priority and estimated_minutes is null from public.tasks where id=p),'Old client rename erased metadata';
  -- Invalid estimates and child priority fail atomically.
  foreach invalid in array array['{"estimatedMinutes":0}'::jsonb,'{"estimatedMinutes":-1}'::jsonb,'{"estimatedMinutes":1.5}'::jsonb,'{"estimatedMinutes":525601}'::jsonb,'{"estimatedMinutes":"45"}'::jsonb,'{"highPriority":null}'::jsonb,'{}'::jsonb] loop
    failed:=false;
    begin
      perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','options')||invalid);
    exception when others then failed:=true; end;
    assert failed,'Invalid options accepted';
  end loop;
  failed:=false;
  begin perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','options','highPriority',true));
  exception when others then failed:=true; end;
  assert failed,'Child priority update accepted';
  failed:=false;
  begin perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',gen_random_uuid(),'action','create','title','Invalid child','topic','school','parentId',p,'highPriority',true));
  exception when others then failed:=true; end;
  assert failed,'Child priority creation accepted';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','delete'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','options','estimatedMinutes',120));
  assert (select deleted_at is not null and estimated_minutes=30 from public.tasks where id=c),'Metadata resurrected a deleted child';
end; $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$
declare n integer; failed boolean:=false;
begin
  assert (select count(*) from public.tasks)=0,'Foreign account reads metadata';
  update public.tasks set high_priority=true,estimated_minutes=1;
  get diagnostics n=row_count;
  assert n=0,'Foreign account updates metadata';
  begin perform public.apply_task_operation(gen_random_uuid(),jsonb_build_object('taskId',gen_random_uuid(),'action','options','highPriority',true));
  exception when insufficient_privilege then failed:=true; end;
  assert failed,'Foreign account invokes metadata RPC';
end; $$;
rollback;
select 'PASS: task metadata defaults, validation, independent merges, retry order, completion preservation, deletion and ownership' as result;
