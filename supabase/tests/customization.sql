begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare
  op uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); parent uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); bad uuid:=gen_random_uuid();
  response jsonb; prior jsonb; captured jsonb; failed boolean; rev bigint; followup jsonb;
  base jsonb:='{"at":"2026-10-15T18:00:00Z","logicalDate":"2026-10-15","timezone":"America/New_York","recordDaily":false}';
  link jsonb:='{"itemId":"musicWork","generation":1,"listId":"music","configurationRevision":1}';
  patch jsonb:='{"blocks":[{"id":"practice","title":"Practice","icon":"music","order":5}],"lists":[{"id":"music","title":"Music","icon":"music","order":3}],"items":[{"id":"musicWork","blockId":"practice","label":"Worked on music tasks?","kind":"tasks","generation":1,"order":0,"listId":"music","visibility":"relevant","completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?"},{"id":"note","kind":"note","label":"Notes"}]}]}';
begin
  perform public.customization_validate_config(public.customization_seed_config('2026-10-09'));
  perform public.customization_validate_config(public.customization_seed_config('2026-10-12'));
  perform public.customization_validate_config(public.customization_seed_config());
  assert exists(select 1 from jsonb_array_elements(public.customization_seed_config()->'items') i where i ? 'inputId'),'Shared baseline lost input metadata';
  assert exists(select 1 from jsonb_array_elements(public.customization_seed_config()->'items') i cross join lateral jsonb_array_elements(i->'followups') f where f ? 'ariaLabel'),'Shared baseline lost accessible follow-up metadata';
  response:=public.apply_customization_operation(op,'2026-10-15',0,patch);
  assert response->>'revision'='1' and response->'change'->>'sequence'='1','Configuration order not assigned';
  response:=public.apply_customization_operation(op,'2026-10-15',0,'{}');
  assert response->'change'->'patch'=patch and (select count(*)=1 from public.config_changes),'Receipt retry appended or changed revision';
  assert not exists(select 1 from jsonb_array_elements(public.customization_config_at('2026-10-14')->'lists') l where l->>'id'='music'),'Configuration rewrote earlier day';
  assert exists(select 1 from jsonb_array_elements(public.customization_config_at('2026-10-15')->'lists') l where l->>'id'='music'),'Effective configuration missing';
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',0,'{}'); exception when serialization_failure then failed:=true; end;
  assert failed and (select count(*)=1 from public.config_changes),'Stale configuration was accepted';
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',1,'{"items":[{"id":"schoolTasks","listId":"music"}]}'); exception when others then failed:=true; end;
  assert failed and (select count(*)=1 from public.config_changes),'Duplicate active list binding accepted';
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',1,'{"blocks":[{"id":"bad","title":"Missing fields"}]}'); exception when others then failed:=true; end;
  assert failed,'Incomplete definition accepted';
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',1,'{"items":[{"id":"wake","kind":"boolean"}]}'); exception when others then failed:=true; end;
  assert failed,'Incompatible type reused old generation';
  response:=public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',1,'{"value":false,"fields":{"reason":"Busy"}}');
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',1,'{"fields":{"note":"Keep this"}}');
  assert (select value->'fields'->>'reason'='Busy' and value->'fields'->>'note'='Keep this' from public.custom_answers where item_id='musicWork'),'Independent answer fields clobbered';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',parent,'action','create','topic','music','title','Song','deadline',jsonb_build_object('date','2026-10-20')));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',child,'parentId',parent,'action','create','topic','music','title','Chorus'));
  op:=gen_random_uuid();
  response:=public.apply_task_operation(op,base||jsonb_build_object('taskId',child,'action','complete','completed',true,'checklistLink',link));
  assert response->'custom_answers'->0->'value'->'value'='true','Linked completion answer not returned';
  captured:=response->'custom_answers'->0->'value';
  assert captured->'selections'->0->'children'->0->>'taskId'=child::text and jsonb_array_length(captured->'selections')=1,'Explicit leaf contribution lost or parent duplicated';
  assert captured->'fields'->>'note'='Keep this','Task completion lost answer fields';
  assert (select completed_at is not null and due_date='2026-10-20' from public.tasks where id=parent),'Custom list parent/deadline behavior lost';
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',1,'{"value":null,"selections":[]}');
  response:=public.apply_task_operation(op,base||jsonb_build_object('taskId',child,'action','complete','completed',true,'checklistLink',link));
  assert response->'custom_answers'->0->'value'->'selections'='[]','Receipt retry resurrected manually removed work';
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',child,'action','complete','completed',false,'checklistLink',link));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',child,'action','complete','completed',true,'checklistLink',link));
  select value into captured from public.custom_answers where item_id='musicWork';
  captured:=jsonb_set(captured,'{selections,0,children,0,manual}','true');
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',1,jsonb_build_object('selections',captured->'selections'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',child,'action','complete','completed',false,'checklistLink',link));
  assert (select value->'selections'->0->'children'->0->'manual'='true' and not(value->'selections'->0->'children'->0 ? 'automatic') and value->'value'='true' from public.custom_answers where item_id='musicWork'),'Undo removed manual work';
  failed:=false; begin perform public.apply_task_operation(bad,base||jsonb_build_object('taskId',child,'action','complete','completed',true,'checklistLink',link||'{"listId":"career"}')); exception when others then failed:=true; end;
  assert failed and (select completed_at is null from public.tasks where id=child) and not exists(select 1 from public.operation_receipts where operation_id=bad),'Invalid binding did not roll back task/event/receipt';
  failed:=false; begin perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',task,'action','create','topic','unknown','title','Unknown')); exception when others then failed:=true; end;
  assert failed,'Unknown custom list accepted';
  -- Legacy input initializes the custom row; custom patches touch only relevant old fields.
  perform public.apply_entry_patch('2026-10-15',gen_random_uuid(),'{"wakeTime":"07:30","wakeReason":"Original","journalText":"Retain journal"}','America/New_York');
  response:=public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','wake',1,'{"fields":{"reason":"New reason"}}');
  assert response->'value'->>'value'='07:30','Partial custom answer lost legacy main input';
  assert (select data->>'wakeReason'='New reason' and data->>'wakeTime'='07:30' and data->>'journalText'='Retain journal' from public.daily_entries where user_id=auth.uid() and logical_date='2026-10-15'),'Legacy answer bridge overwrote unrelated data';
  op:=gen_random_uuid();
  perform public.apply_entry_patch('2026-10-15',op,'{"wakeTime":"08:00"}','America/New_York');
  assert (select value->>'value'='08:00' and value->'fields'->>'reason'='New reason' from public.custom_answers where item_id='wake'),'Old queued patch did not reach custom answer';
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','wake',1,'{"value":"08:30"}');
  perform public.apply_entry_patch('2026-10-15',op,'{"wakeTime":"08:00"}','America/New_York');
  assert (select value->>'value'='08:30' from public.custom_answers where item_id='wake'),'Old receipt retry rewrote newer answer';
  -- Later type edits retain the original schema and history instead of casting it.
  perform public.apply_customization_operation(gen_random_uuid(),'2026-10-16',1,'{"items":[{"id":"musicWork","kind":"text","generation":2,"listId":null,"completion":{"op":"not-empty","field":"value"}}]}');
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-16','musicWork',2,'{"value":"New typed answer"}');
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-16','musicWork',1,'{"value":true}');
  assert (select count(*)=2 from public.custom_answers where item_id='musicWork' and logical_date='2026-10-16'),'Retained generation overwritten';
  -- A scheduled tomorrow schema already owns generation 2. A later today edit
  -- must allocate generation 3, even though today's active schema is still 1.
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',2,'{"items":[{"id":"musicWork","kind":"number","generation":2,"listId":null,"completion":{"op":"compare","field":"value","operator":"gte","value":1}}]}'); exception when others then failed:=true; end;
  assert failed,'Future answer generation reused by a later today edit';
  perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',2,'{"items":[{"id":"musicWork","kind":"number","generation":3,"listId":null,"completion":{"op":"compare","field":"value","operator":"gte","value":1}}]}');
  assert (select i->>'generation'='3' from jsonb_array_elements(public.customization_config_at('2026-10-16')->'items') i where i->>'id'='musicWork'),'Newly allocated schema did not apply';
  -- Renaming option labels is compatible; removing stable option IDs is not.
  perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',3,'{"items":[{"id":"mood","blockId":"practice","label":"Mood","kind":"choice","generation":1,"order":2,"completion":{"op":"not-empty","field":"value"},"options":[{"id":"good","label":"Good"},{"id":"okay","label":"Okay"}],"followups":[]}]}');
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',4,'{"items":[{"id":"mood","options":[{"id":"good","label":"Feeling good"}]}]}'); exception when others then failed:=true; end;
  assert failed,'Removed main option reused old answer schema';
  select jsonb_set(i->'followups','{0,options}','[{"id":"shake","label":"Shake"}]'::jsonb) into followup from jsonb_array_elements(public.customization_seed_config()->'items') i where i->>'id'='amBreakfast';
  failed:=false; begin perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',4,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id','amBreakfast','followups',followup)))); exception when others then failed:=true; end;
  assert failed,'Removed follow-up option reused old answer schema';
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',3,'{"value":3,"fields":{"note":"Retain this removed field"}}');
  perform public.apply_customization_operation(gen_random_uuid(),'2026-10-15',4,'{"items":[{"id":"musicWork","followups":[]}]}');
  perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',3,'{"value":4}');
  assert (select value->>'value'='4' and value->'fields'->>'note'='Retain this removed field' from public.custom_answers where item_id='musicWork' and generation=3),'Removing a follow-up blocked later input or discarded history';
  failed:=false; begin perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','musicWork',3,'{"fields":{"neverDefined":"Unsafe extra field"}}'); exception when others then failed:=true; end;
  assert failed,'Unknown unconfigured answer field accepted';
  -- A stale completion of a deleted task returns an authoritative empty answer,
  -- allowing its optimistic client selection to be removed without inventing work.
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',task,'action','create','topic','music','title','Deleted before sync'));
  perform public.apply_task_operation(gen_random_uuid(),base||jsonb_build_object('taskId',task,'action','delete'));
  response:=public.apply_task_operation(gen_random_uuid(),base||'{"at":"2026-10-16T18:00:00Z","logicalDate":"2026-10-16"}'||jsonb_build_object('taskId',task,'action','complete','completed',true,'checklistLink',link));
  assert jsonb_array_length(response->'custom_answers')=1 and response->'custom_answers'->0->'value'->'selections'='[]','Rejected task completion did not acknowledge current answer';
  assert not public.customization_scheduled('{"weekdays":[1,2,3,4,5]}','2026-10-17') and public.customization_scheduled('{"startDate":"2026-10-15","endDate":"2026-10-15"}','2026-10-15'),'Schedule boundaries wrong';
  assert not public.customization_valid_patch('{"items":[{"id":"bad","completion":{"op":"equals","field":"value"}}]}'),'Incomplete rule accepted';
  failed:=false; begin perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','screenTime',1,'{"value":1441}'); exception when others then failed:=true; end;
  assert failed,'Out-of-range typed input accepted';
  failed:=false; begin update public.config_changes set patch='{}' where sequence=1; exception when insufficient_privilege then failed:=true; end;
  assert failed,'Configuration history mutable';
  assert not has_table_privilege('anon','public.config_changes','SELECT') and not has_table_privilege('anon','public.custom_answers','INSERT'),'Anonymous grants exposed private tables';
  assert not has_function_privilege('anon','public.apply_customization_operation(uuid,date,bigint,jsonb)','EXECUTE'),'Anonymous RPC grant';
end; $$;
reset role;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
do $$ declare failed boolean:=false; begin
  assert (select count(*)=0 from public.config_changes) and (select count(*)=0 from public.custom_answers),'Other account can read customization';
  begin perform public.apply_custom_answer_operation(gen_random_uuid(),'2026-10-15','wake',1,'{"value":"07:00"}'); exception when insufficient_privilege then failed:=true; end;
  assert failed,'Non-owner wrote an answer';
end; $$;
rollback;
select 'PASS: configuration revisions, schedules, conflicts, validation, typed answers, list links, atomicity, undo, retries, legacy bridges and isolation' as result;
