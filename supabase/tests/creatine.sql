-- Rollback-only fixture edits verify additive validation and the existing patch RPC.
begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare d date:='2026-10-13'; operation uuid:=gen_random_uuid(); result jsonb; revision bigint;
begin
  assert public.valid_daily_data('{"creatineStatus":true,"creatineReason":""}'), 'Creatine Yes rejected';
  assert public.valid_daily_data('{"creatineStatus":false,"creatineReason":"Forgot"}'), 'Creatine No/reason rejected';
  assert public.valid_daily_data('{"creatineStatus":null}'), 'Unanswered Creatine rejected';
  assert not public.valid_daily_data('{"creatineStatus":"yes"}'), 'Invalid Creatine answer accepted';
  assert not public.valid_daily_data('{"creatineReason":7}'), 'Non-text reason accepted';
  assert public.valid_daily_data('{"amBreakfast":{"status":true,"choice":"meal"},"snackStatus":true,"liftedStatus":false}'), 'Existing diet/body fields invalidated';
  result:=public.apply_entry_patch(d,operation,'{"creatineStatus":false,"creatineReason":"Test: forgot"}','Pacific/Kiritimati');
  result:=public.apply_entry_patch(d,gen_random_uuid(),'{"liftedReason":"Test: another device"}','Pacific/Kiritimati');
  assert result->'data'->>'creatineReason'='Test: forgot', 'Different-field merge lost Creatine';
  result:=public.apply_entry_patch(d,gen_random_uuid(),'{"creatineStatus":true}','Pacific/Kiritimati');
  assert result->'data'->>'creatineReason'='Test: forgot', 'Yes erased hidden reason';
  revision:=(result->>'revision')::bigint;
  result:=public.apply_entry_patch(d,operation,'{"creatineStatus":false,"creatineReason":"Test: forgot"}','Pacific/Kiritimati');
  assert (result->>'revision')::bigint=revision and result->'data'->>'creatineStatus'='true', 'Replay overwrote later answer';
  result:=public.apply_entry_patch(d,gen_random_uuid(),'{"creatineStatus":null}','Pacific/Kiritimati');
  assert result->'data'->'creatineStatus'='null'::jsonb and result->'data'->>'creatineReason'='Test: forgot', 'Clearing lost saved reason';
end; $$;
rollback;
select 'PASS: Creatine validation, legacy compatibility, merge, hidden reason preservation, clearing and idempotent retry' as result;
