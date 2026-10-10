begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
  p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  result jsonb; failed boolean:=false; n integer; original timestamptz;
  base jsonb:='{"at":"2026-10-10T03:00:00Z","logicalDate":"2026-10-09","timezone":"America/New_York"}';
begin
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','create','title','Physics','topic','school','parentId',null));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','create','title','Read','topic','school','parentId',p));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',b,'action','create','title','Solve','topic','school','parentId',p));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','complete','completed',true));
  assert (select completed_at is null from public.tasks where id=p),'Parent checkbox toggled children';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','complete','completed',true));
  assert (select completed_at is null from public.tasks where id=p),'Partial parent completed';
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',b,'action','complete','completed',true));
  select completed_at into original from public.tasks where id=p;
  assert original is not null,'Parent did not complete';
  assert (select count(*) from public.task_events where operation_id=op)=2,'Child and parent completion not recorded';
  assert (select bool_and(logical_date='2026-10-09') from public.task_events where operation_id=op),'Logical completion date lost';
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',b,'action','complete','completed',true));
  assert (select count(*) from public.task_events where operation_id=op)=2,'Retry duplicated history';
  perform public.apply_task_operation(gen_random_uuid(),base||'{"at":"2026-10-10T03:30:00Z"}'||jsonb_build_object('taskId',b,'action','complete','completed',false));
  assert (select completed_at is null from public.tasks where id=p),'Parent not reopened';
  perform public.apply_task_operation(gen_random_uuid(),base||'{"at":"2026-10-10T04:00:00Z"}'||jsonb_build_object('taskId',b,'action','complete','completed',true));
  assert (select completed_at>original from public.tasks where id=p),'Parent timer not reset';
  assert (select count(*) from public.task_events where task_id=p)=3,'Parent completion/reopening history lost';
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',b,'action','complete','completed',true));
  assert (select completed_at>original from public.tasks where id=p),'Old acknowledgement reset timer';
  begin
    perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',gen_random_uuid(),'action','create','title','Nested','topic','school','parentId',a));
  exception when others then failed:=true; end;
  assert failed,'Nested children accepted'; failed:=false;
  begin
    perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',gen_random_uuid(),'action','create','title','Wrong topic','topic','career','parentId',p));
  exception when others then failed:=true; end;
  assert failed,'Cross-topic child accepted'; failed:=false;
  begin
    perform public.apply_task_operation(gen_random_uuid(),base||'{"logicalDate":"2026-10-10"}'||jsonb_build_object('taskId',b,'action','complete','completed',true));
  exception when others then failed:=true; end;
  assert failed,'Incorrect logical date accepted';
  perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),jsonb_build_object('schoolTasksStatus',true,'schoolTasksWorkedOn',jsonb_build_array(jsonb_build_object('taskId',p,'title','Physics','children',jsonb_build_array(jsonb_build_object('taskId',a,'title','Read'))))),'America/New_York');
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','rename','title','Renamed'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','delete'));
  assert (select count(*) from public.tasks where (id=p or parent_id=p) and deleted_at is not null)=3,'Group deletion failed';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','rename','title','Resurrected'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',gen_random_uuid(),'action','create','title','Stale child','topic','school','parentId',p));
  assert (select title='Renamed' and deleted_at is not null from public.tasks where id=p),'Deleted task resurrected';
  assert (select count(*) from public.tasks where parent_id=p)=2,'Stale child resurrected group';
  assert (select data->'schoolTasksWorkedOn'->0->>'title'='Physics' from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Historical title changed';
  assert (select count(*) from public.task_events where task_id=p)=3,'Deletion erased history';
  assert not public.valid_daily_data('{"schoolTasksWorkedOn":[{"taskId":"bad","title":"Bad","children":[]}]}'),'Invalid task snapshot accepted';
  assert public.valid_daily_data('{"schoolTasksStatus":null,"careerTasksReason":"Optional"}'),'Valid new fields rejected';
  -- Last child deletion converts the parent into an incomplete standalone task.
  p:=gen_random_uuid(); a:=gen_random_uuid();
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','create','title','One child','topic','life'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','create','title','Child','topic','life','parentId',p));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','complete','completed',true));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','delete'));
  assert (select completed_at is null from public.tasks where id=p),'Last child deletion left completed parent';
end; $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$
declare failed boolean:=false; n integer;
begin
  assert (select count(*) from public.tasks)=0,'Other account sees tasks';
  assert (select count(*) from public.task_events)=0,'Other account sees history';
  update public.tasks set title='Foreign edit'; get diagnostics n=row_count; assert n=0,'Other account edits tasks';
  begin perform public.apply_task_operation(gen_random_uuid(),'{"action":"delete"}'); exception when insufficient_privilege then failed:=true; end;
  assert failed,'Other account invokes task RPC';
end; $$;
set local role anon;
do $$
declare failed boolean:=false;
begin
  begin perform 1 from public.tasks; exception when insufficient_privilege then failed:=true; end;
  assert failed,'Anonymous task access'; failed:=false;
  begin perform public.apply_task_operation(gen_random_uuid(),'{}'); exception when insufficient_privilege then failed:=true; end;
  assert failed,'Anonymous task RPC';
end; $$;
rollback;
select 'PASS: task hierarchy, completion history, idempotency, dates, snapshots, deletion, validation and isolation' as result;
