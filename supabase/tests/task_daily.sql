begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
  p uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); life uuid:=gen_random_uuid();
  op uuid:=gen_random_uuid(); before_data jsonb; snapshot jsonb; response jsonb; rev bigint; timer timestamptz; failed boolean;
  base jsonb:='{"at":"2026-10-10T05:59:00Z","logicalDate":"2026-10-09","timezone":"America/New_York","recordDaily":true}';
  later jsonb:='{"at":"2026-10-10T06:01:00Z","logicalDate":"2026-10-10","timezone":"America/New_York","recordDaily":true}';
begin
  perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),'{"schoolTasksStatus":false,"schoolTasksWorkedOn":[],"schoolTasksReason":"Busy","careerTasksWorkedOn":[],"careerTasksStatus":null,"journalText":"Unrelated"}','America/New_York');
  perform public.apply_entry_patch('2026-10-10',gen_random_uuid(),'{"schoolTasksWorkedOn":[],"schoolTasksStatus":null}','America/New_York');
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','create','topic','school','title','Essay','estimatedMinutes',90,'highPriority',true));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','create','topic','school','title','Outline','parentId',p));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',b,'action','create','topic','school','title','Write','parentId',p));
  response:=public.apply_task_operation(op,base||jsonb_build_object('taskId',a,'action','complete','completed',true));
  assert response->'entry'->'data'->'schoolTasksStatus'='true','Completion did not return Yes';
  assert response->'entry'->'data'->'schoolTasksWorkedOn'->0->'children'->0->>'taskId'=a::text,'Immediate child hierarchy lost';
  assert (select completed_at is null and high_priority and estimated_minutes=90 from public.tasks where id=p),'Parent/options altered';
  select data into snapshot from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09';
  assert snapshot->>'schoolTasksReason'='Busy' and snapshot->>'journalText'='Unrelated','Unrelated fields lost';
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',b,'action','complete','completed',true));
  assert (select completed_at is not null from public.tasks where id=p),'Final-child parent transition lost';
  assert (select jsonb_array_length(data->'schoolTasksWorkedOn')=1 and jsonb_array_length(data->'schoolTasksWorkedOn'->0->'children')=1 and data->'schoolTasksWorkedOn'->0->'children'->0->>'taskId'=b::text from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-10'),'Older sibling or duplicate parent selected';
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',a,'action','complete','completed',false));
  assert (select data=snapshot from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Later undo rewrote earlier day';
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',b,'action','complete','completed',false));
  assert (select data->'schoolTasksStatus'='null' and data->'schoolTasksWorkedOn'='[]' from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-10'),'Empty undo did not reset to unanswered';
  -- Recheck once, then a newer manual correction must win over old receipt retry.
  op:=gen_random_uuid();
  perform public.apply_task_operation(op,later||jsonb_build_object('taskId',b,'action','complete','completed',true));
  select completed_at into timer from public.tasks where id=b;
  perform public.apply_entry_patch('2026-10-10',gen_random_uuid(),'{"schoolTasksStatus":null,"schoolTasksWorkedOn":[]}','America/New_York');
  select revision into rev from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-10';
  response:=public.apply_task_operation(op,later||jsonb_build_object('taskId',b,'action','complete','completed',true));
  assert response->'entry'->'data'->'schoolTasksWorkedOn'='[]','Lost acknowledgement resurrected manual removal';
  assert (select revision=rev from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-10'),'Retry rewrote daily record';
  assert (select completed_at=timer from public.tasks where id=b),'Retry reset archive timer';
  -- Deleting the unfinished child completes its parent, without any daily contribution.
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',a,'action','delete'));
  assert (select completed_at is not null from public.tasks where id=p),'Deletion edge did not complete parent';
  assert (select revision=rev from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-10'),'Deletion recorded daily work';
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',p,'action','rename','title','Renamed'));
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',p,'action','options','estimatedMinutes',120));
  perform public.apply_task_operation(gen_random_uuid(),later||jsonb_build_object('taskId',p,'action','delete'));
  assert (select data=snapshot from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Snapshots erased after rename/deletion';
  -- Career standalone completions from two devices merge under the same daily row lock.
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','create','topic','career','title','Resume'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',life,'action','create','topic','career','title','Interview'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',c,'action','complete','completed',true));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',life,'action','complete','completed',true));
  assert (select jsonb_array_length(data->'careerTasksWorkedOn')=2 and data->'careerTasksStatus'='true' from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Two-device selections lost';
  -- Legacy manual parent survives automatic child undo. Automatic container retains manual child.
  p:=gen_random_uuid(); a:=gen_random_uuid(); b:=gen_random_uuid();
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',p,'action','create','topic','school','title','Manual parent'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','create','topic','school','title','Auto child','parentId',p));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',b,'action','create','topic','school','title','Manual child','parentId',p));
  perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),jsonb_build_object('schoolTasksWorkedOn',jsonb_build_array(jsonb_build_object('taskId',p,'title','Manual parent','children','[]'::jsonb))),'America/New_York');
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','complete','completed',true));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','complete','completed',false));
  assert (select jsonb_array_length(data->'schoolTasksWorkedOn')=1 and data->'schoolTasksWorkedOn'->0->'children'='[]' from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Manual parent removed';
  perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),'{"schoolTasksWorkedOn":[]}','America/New_York');
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','complete','completed',true));
  select data->'schoolTasksWorkedOn' into before_data from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09';
  before_data:=jsonb_set(before_data,'{0,children}',before_data->0->'children'||jsonb_build_array(jsonb_build_object('taskId',b,'title','Manual child','manual',true)));
  perform public.apply_entry_patch('2026-10-09',gen_random_uuid(),jsonb_build_object('schoolTasksWorkedOn',before_data),'America/New_York');
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',a,'action','complete','completed',false));
  assert (select data->'schoolTasksWorkedOn'->0->'children'->0->>'taskId'=b::text and data->'schoolTasksStatus'='true' from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Manual child/container removed';
  -- Life and old queued clients cannot invent daily work; no backfill on old receipts.
  select data into snapshot from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09';
  life:=gen_random_uuid();
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',life,'action','create','topic','life','title','Laundry'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',life,'action','complete','completed',true));
  op:=gen_random_uuid();
  perform public.apply_task_operation(op,(base-'recordDaily')||jsonb_build_object('taskId',b,'action','complete','completed',true));
  perform public.apply_task_operation(op,base||jsonb_build_object('taskId',b,'action','complete','completed',true)); -- Never backfill an old receipt.
  assert (select data=snapshot from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-09'),'Life or legacy operations recorded work';
  assert not public.valid_daily_data(jsonb_build_object('schoolTasksWorkedOn',jsonb_build_array(jsonb_build_object('taskId',p,'title','Invalid','manual','false','children','[]'::jsonb)))),'Invalid provenance accepted';
  assert not public.valid_daily_data(jsonb_build_object('schoolTasksWorkedOn',jsonb_build_array(jsonb_build_object('taskId',p,'title','Invalid','automatic','bad','children','[]'::jsonb)))),'Invalid operation marker accepted';
  -- Invalid daily data fails the entire task/event/receipt transaction.
  failed:=false;
  begin
    perform public.apply_task_operation(gen_random_uuid(),base||'{"at":"2026-10-08T16:00:00Z","logicalDate":"2026-10-08"}'||jsonb_build_object('taskId',a,'action','complete','completed',true));
  exception when others then failed:=true; end;
  assert failed and (select completed_at is null from public.tasks where id=a),'Daily failure did not roll back task';
end; $$;
rollback;
select 'PASS: automatic daily work, hierarchy, provenance undo, manual edits, retry receipts, snapshots, options, deletion, legacy and atomicity' as result;
