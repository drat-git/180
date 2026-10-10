begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
 base jsonb:='{"at":"2026-10-10T16:00:00Z","logicalDate":"2026-10-10","timezone":"America/New_York"}';
 next_day jsonb:='{"at":"2026-10-11T06:00:00Z","logicalDate":"2026-10-11","timezone":"America/New_York"}';
 result jsonb; failed boolean:=false; n integer;
begin
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',a,'action','create','title','Basketball','notes','Park','itemType','reusable'));
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',a,'action','log','logged',true));
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',a,'action','log','logged',true));
 assert (select count(*) from public.anti_rotting_logs where item_id=a)=1,'Duplicate daily log';
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',a,'action','complete','completed',true));
 assert (select data->>'completedAt' is null from public.anti_rotting_items where id=a),'Reusable completed';
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','create','title','Documentary','notes','Original note','itemType','one-time'));
 result:=public.apply_anti_operation(op,base||jsonb_build_object('itemId',b,'action','complete','completed',true));
 assert result->'items'->0->>'completedAt' is not null,'Completion missing';
 assert (result->'logs'->0->>'manual')::boolean=false and result->'logs'->0->>'completionOperationId'=op::text,'Auto log missing';
 perform public.apply_anti_operation(op,base||jsonb_build_object('itemId',b,'action','complete','completed',true));
 assert (select count(*) from public.anti_rotting_events where item_id=b)=1,'Retry duplicated event';
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','complete','completed',false));
 assert (select data->>'completionOperationId' is null and (data->>'manual')::boolean=false from public.anti_rotting_logs where item_id=b),'Auto log not undone';
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','log','logged',true));
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','complete','completed',true));
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','complete','completed',false));
 assert (select (data->>'manual')::boolean from public.anti_rotting_logs where item_id=b),'Manual log erased';
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','complete','completed',true));
 perform public.apply_anti_operation(gen_random_uuid(),next_day||jsonb_build_object('itemId',b,'action','edit','title','Renamed','notes','New note','itemType','reusable'));
 assert (select data->>'completedAt' is null from public.anti_rotting_items where id=b),'Type conversion did not reopen';
 assert (select data->>'title'='Documentary' and data->>'notes'='Original note' and data->>'completionOperationId' is not null from public.anti_rotting_logs where item_id=b),'Past snapshot altered';
 perform public.apply_anti_operation(gen_random_uuid(),next_day||jsonb_build_object('itemId',b,'action','delete'));
 perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',b,'action','edit','title','Resurrected','notes','','itemType','reusable'));
 assert (select data->>'title'='Renamed' and data->>'deletedAt' is not null from public.anti_rotting_items where id=b),'Deletion lost';
 assert (select count(*) from public.anti_rotting_events where item_id=b)=6,'History lost';
 perform public.apply_anti_operation(gen_random_uuid(),next_day||jsonb_build_object('itemId',a,'action','log','logged',true));
 perform public.apply_anti_operation(gen_random_uuid(),next_day||jsonb_build_object('itemId',a,'action','delete'));
 perform public.apply_anti_operation(gen_random_uuid(),next_day||jsonb_build_object('itemId',a,'action','log','logged',false));
 assert (select (data->>'manual')::boolean=false from public.anti_rotting_logs where item_id=a and logical_date='2026-10-11'),'Cannot remove deleted item log';
 begin
  perform public.apply_anti_operation(gen_random_uuid(),base||jsonb_build_object('itemId',c,'action','create','title','','notes','','itemType','reusable'));
 exception when others then failed:=true; end;
 assert failed,'Empty title accepted';failed:=false;
 begin
  perform public.apply_anti_operation(gen_random_uuid(),base||'{"logicalDate":"2026-10-11"}'||jsonb_build_object('itemId',a,'action','log','logged',true));
 exception when others then failed:=true; end;
 assert failed,'Wrong day accepted';failed:=false;
 begin update public.anti_rotting_logs set data=data||'{"manual":true}'; exception when insufficient_privilege then failed:=true; end;
 assert failed,'Direct write bypassed RPC';failed:=false;
 begin delete from public.anti_rotting_events; exception when insufficient_privilege then failed:=true; end;
 assert failed,'History deletion allowed';
end; $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$
declare failed boolean:=false;n integer;
begin
 assert (select count(*) from public.anti_rotting_items)=0,'Foreign items readable';
 assert (select count(*) from public.anti_rotting_logs)=0,'Foreign logs readable';
 assert (select count(*) from public.anti_rotting_events)=0,'Foreign events readable';
 update public.anti_rotting_items set data='{}';get diagnostics n=row_count;assert n=0,'Foreign update allowed';
 begin perform public.apply_anti_operation(gen_random_uuid(),'{}');exception when insufficient_privilege then failed:=true;end;
 assert failed,'Foreign RPC allowed';
end; $$;
set local role anon;
do $$
declare failed boolean:=false;
begin
 begin perform 1 from public.anti_rotting_items;exception when insufficient_privilege then failed:=true;end;
 assert failed,'Anon items readable';failed:=false;
 begin perform public.apply_anti_operation(gen_random_uuid(),'{}');exception when insufficient_privilege then failed:=true;end;
 assert failed,'Anon RPC allowed';
end; $$;
rollback;
select 'PASS: Anti Rotting logging, completion, undo, snapshots, retries, dates, deletion and access isolation' as result;
