-- Rollback-only validation and field-patch checks; no owner records persist.
begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare d date:='2026-10-09'; old_op uuid:=gen_random_uuid(); result jsonb; revision bigint;
begin
  assert public.valid_daily_data('{"amBreakfast":{"status":true,"choice":null}}'), 'Pending required choice must save';
  assert public.valid_daily_data('{"amBreakfast":{"status":true,"choice":"shake"},"snackStatus":true,"snackDescription":"Fruit"}'), 'New food fields rejected';
  assert public.valid_daily_data('{"amBreakfast":{"status":false,"choice":null},"amBreakfastReason":"Not hungry","amBreakfastDescription":"Eggs"}'), 'Hidden text rejected';
  assert public.valid_daily_data('{"snack1Status":true,"snack2Description":"Legacy food","meal1Status":true,"shakeStatus":false}'), 'Legacy food invalidated';
  assert not public.valid_daily_data('{"amBreakfast":{"status":true,"choice":"other"}}'), 'Unknown choice accepted';
  assert not public.valid_daily_data('{"amBreakfast":{"status":false,"choice":"meal"}}'), 'Choice without Yes accepted';
  assert not public.valid_daily_data('{"amBreakfast":{"status":null,"choice":"shake"}}'), 'Choice without answer accepted';
  assert not public.valid_daily_data('{"amBreakfast":{"status":"yes","choice":null}}'), 'Invalid answer accepted';
  assert not public.valid_daily_data('{"amBreakfast":{"status":true}}'), 'Partial coupled answer accepted';
  assert not public.valid_daily_data('{"amBreakfast":{"status":true,"choice":null,"extra":1}}'), 'Unknown nested field accepted';
  assert not public.valid_daily_data('{"snackStatus":"yes"}'), 'Invalid snack answer accepted';
  result:=public.apply_entry_patch(d,old_op,'{"amBreakfast":{"status":true,"choice":"meal"},"amBreakfastDescription":"Example eggs","snack1Description":"Preserved old snack"}','America/New_York');
  result:=public.apply_entry_patch(d,gen_random_uuid(),'{"snackStatus":true,"snackDescription":"Example fruit"}','America/New_York');
  assert result->'data'->'amBreakfast'->>'choice'='meal', 'Different-field merge lost breakfast';
  result:=public.apply_entry_patch(d,gen_random_uuid(),'{"amBreakfast":{"status":true,"choice":null}}','America/New_York');
  assert result->'data'->>'amBreakfastDescription'='Example eggs', 'Reset erased hidden meal description';
  assert result->'data'->>'snack1Description'='Preserved old snack', 'New food edits erased legacy snack';
  revision:=(result->>'revision')::bigint;
  result:=public.apply_entry_patch(d,old_op,'{"amBreakfast":{"status":true,"choice":"meal"}}','America/New_York');
  assert (result->>'revision')::bigint=revision and result->'data'->'amBreakfast'->'choice'='null'::jsonb, 'Lost acknowledgement replay restored an old choice';
end; $$;
rollback;
select 'PASS: food validation, legacy compatibility, coupled breakfast state, hidden text, merge and idempotent retries' as result;
