begin;
select set_config('request.jwt.claims',json_build_object('sub',(select user_id from public.app_owner),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare failed boolean:=false; begin
 assert not has_function_privilege('authenticated','public.push_backend_config(text,text)','execute'),'Client can retrieve private push keys';
 assert not has_function_privilege('anon','public.push_backend_config(text,text)','execute'),'Anonymous can retrieve keys';
 assert not has_function_privilege('authenticated','public.claim_push_delivery(uuid,date,timestamptz)','execute'),'Client can run dispatch';
 begin perform 1 from public.push_installations; exception when insufficient_privilege then failed:=true; end;
 assert failed,'Client can directly access subscription endpoints';
end; $$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare id uuid:=gen_random_uuid(); owner uuid; keys jsonb; begin
 select user_id into owner from public.app_owner;
 keys:=public.push_backend_config();
 assert length(keys->>'publicKey')=87,'VAPID public key not ready';
 assert length(keys->>'privateKey')=43,'VAPID private key not ready';
 insert into public.push_installations(id,user_id,origin,endpoint,p256dh,auth,timezone,next_send_at)
 values(id,owner,'https://test.example.invalid','https://web.push.apple.com/test-'||id,repeat('A',87),repeat('B',22),'America/New_York',now());
 assert public.claim_push_delivery(id,'2026-10-12',now()+interval '5 hours'),'Initial dispatch not claimed';
 assert not public.claim_push_delivery(id,'2026-10-12',now()+interval '5 hours'),'Concurrent dispatch duplicated';
 update public.push_deliveries set lease_until=now()-interval '1 minute' where installation_id=id;
 assert public.claim_push_delivery(id,'2026-10-12',now()+interval '5 hours'),'Retry not claimed';
 update public.push_deliveries set lease_until=now()-interval '1 minute' where installation_id=id;
 assert public.claim_push_delivery(id,'2026-10-12',now()+interval '5 hours'),'Final retry not claimed';
 update public.push_deliveries set lease_until=now()-interval '1 minute' where installation_id=id;
 assert not public.claim_push_delivery(id,'2026-10-12',now()+interval '5 hours'),'Retry limit not enforced';
 assert not public.claim_push_delivery(id,'2026-10-11',now()-interval '1 minute'),'Expired reminder claimed';
 assert (select count(*) from public.push_deliveries where installation_id=id)=1,'Duplicate delivery records';
 update public.push_deliveries set status='sent',attempts=1 where installation_id=id;
 assert not public.claim_push_delivery(id,'2026-10-12',now()+interval '5 hours'),'Sent reminder replayed';
end; $$;
rollback;
select 'PASS: push secret isolation, subscription isolation, claims, concurrency, retry limits, expiry and deduplication' as result;
