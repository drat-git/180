-- Anti Rotting uses independent records and durable snapshots, never daily-entry rewrites.
create table public.anti_rotting_items (
  id uuid primary key, user_id uuid not null references auth.users(id), data jsonb not null,
  unique(user_id,id),
  check(coalesce(data->>'id'=id::text and data->>'userId'=user_id::text and jsonb_typeof(data->'title')='string' and length(btrim(data->>'title')) between 1 and 500 and jsonb_typeof(data->'notes')='string' and length(data->>'notes')<=5000 and data->>'itemType' in ('reusable','one-time') and (data->>'itemType'='one-time' or data->>'completedAt' is null),false))
);
create table public.anti_rotting_logs (
  id text primary key, user_id uuid not null, item_id uuid not null, logical_date date not null, data jsonb not null,
  unique(user_id,item_id,logical_date),
  foreign key(user_id,item_id) references public.anti_rotting_items(user_id,id),
  check(coalesce(data->>'id'=id and data->>'userId'=user_id::text and data->>'itemId'=item_id::text and data->>'logicalDate'=logical_date::text and jsonb_typeof(data->'manual')='boolean',false))
);
create table public.anti_rotting_events (
  id text primary key, user_id uuid not null, item_id uuid not null, operation_id uuid not null, logical_date date not null, data jsonb not null,
  unique(user_id,operation_id,item_id),
  foreign key(user_id,item_id) references public.anti_rotting_items(user_id,id),
  check(coalesce(data->>'id'=id and data->>'userId'=user_id::text and data->>'itemId'=item_id::text and data->>'logicalDate'=logical_date::text and data->>'operationId'=operation_id::text and data->>'type' in ('completed','reopened'),false))
);
create index anti_logs_owner_date on public.anti_rotting_logs(user_id,logical_date);
create index anti_events_owner_date on public.anti_rotting_events(user_id,logical_date);
create index anti_events_owner_item on public.anti_rotting_events(user_id,item_id);
alter table public.anti_rotting_items enable row level security;
alter table public.anti_rotting_logs enable row level security;
alter table public.anti_rotting_events enable row level security;
create policy anti_items_owner on public.anti_rotting_items for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy anti_logs_owner on public.anti_rotting_logs for all to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy anti_events_read on public.anti_rotting_events for select to authenticated using(user_id=(select auth.uid()));
create policy anti_events_insert on public.anti_rotting_events for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
revoke all on public.anti_rotting_items,public.anti_rotting_logs,public.anti_rotting_events from anon,authenticated;
grant select,insert,update on public.anti_rotting_items,public.anti_rotting_logs to authenticated;
grant select,insert on public.anti_rotting_events to authenticated;
create function public.guard_anti_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or current_setting('app180.anti_writer',true) is distinct from auth.uid()::text then raise insufficient_privilege using message='Use Anti Rotting operation RPC'; end if;
 if TG_OP='UPDATE' then
   if (new.id,new.user_id) is distinct from (old.id,old.user_id) then raise exception 'Identity is immutable'; end if;
   if TG_TABLE_NAME='anti_rotting_items' and old.data->>'deletedAt' is not null then raise exception 'Deleted activity is immutable'; end if;
 end if;
 return new;
end; $$;
create trigger anti_items_guard before insert or update on public.anti_rotting_items for each row execute function public.guard_anti_write();
create trigger anti_logs_guard before insert or update on public.anti_rotting_logs for each row execute function public.guard_anti_write();
create trigger anti_events_guard before insert on public.anti_rotting_events for each row execute function public.guard_anti_write();

create function public.apply_anti_operation(p_operation uuid,p_command jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_id uuid; v_action text; v_at timestamptz; v_date date; v_tz text; v_item jsonb; v_log jsonb;
 v_log_id text; v_title text; v_notes text; v_type text; v_complete boolean; v_transition boolean := false;
 v_snapshot jsonb; v_event jsonb; v_event_id text; v_receipt public.operation_receipts;
begin
 if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('180:anti:'||auth.uid()::text,0));
 if p_operation is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Invalid activity command'; end if;
 v_id:=(p_command->>'itemId')::uuid; v_action:=p_command->>'action'; v_at:=(p_command->>'at')::timestamptz; v_date:=(p_command->>'logicalDate')::date; v_tz:=p_command->>'timezone';
 if v_id is null or v_action is null or v_action not in ('create','edit','log','complete','delete') or v_at is null or v_date is null or v_tz is null then raise exception 'Invalid activity command'; end if;
 if not exists(select 1 from pg_timezone_names where name=v_tz) or v_date<>((v_at at time zone v_tz)-interval '2 hours')::date then raise exception 'Invalid activity date or timezone'; end if;
 select * into v_receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
 if found then
  if v_receipt.entity_key<>'anti:'||v_id::text then raise exception 'Operation ID reused'; end if;
 else
  perform set_config('app180.anti_writer',auth.uid()::text,true);
  select data into v_item from public.anti_rotting_items where id=v_id and user_id=auth.uid();
  v_log_id:=auth.uid()::text||':'||v_id::text||':'||v_date::text;
  select data into v_log from public.anti_rotting_logs where id=v_log_id and user_id=auth.uid();
  if v_action in ('create','edit') then
   v_title:=btrim(p_command->>'title'); v_notes:=coalesce(p_command->>'notes',''); v_type:=p_command->>'itemType';
   if jsonb_typeof(p_command->'title') is distinct from 'string' or v_title is null or length(v_title) not between 1 and 500 or length(v_notes)>5000 or (p_command ? 'notes' and jsonb_typeof(p_command->'notes') is distinct from 'string') or v_type is null or v_type not in ('reusable','one-time') then raise exception 'Invalid title, notes, or activity type'; end if;
  end if;
  if v_action='complete' and jsonb_typeof(p_command->'completed') is distinct from 'boolean' then raise exception 'Invalid completion value'; end if;
  if v_action='log' and jsonb_typeof(p_command->'logged') is distinct from 'boolean' then raise exception 'Invalid logging value'; end if;
  if v_action='create' and v_item is null then
   v_item:=jsonb_build_object('id',v_id,'userId',auth.uid(),'title',v_title,'notes',v_notes,'itemType',v_type,'completedAt',null,'completionOperationId',null,'deletedAt',null,'createdAt',p_command->>'at','updatedAt',p_command->>'at','revision',0);
   insert into public.anti_rotting_items(id,user_id,data) values(v_id,auth.uid(),v_item);
  elsif v_item is not null and v_item->>'deletedAt' is null and v_action<>'create' then
   v_snapshot:=jsonb_build_object('title',v_item->>'title','notes',v_item->>'notes','itemType',v_item->>'itemType');
   if (v_action='complete' and v_item->>'itemType'='one-time') or (v_action='edit' and v_type='reusable') then
    v_complete:=v_action='complete' and (p_command->>'completed')::boolean;
    v_transition:=(v_item->>'completedAt' is not null)<>v_complete;
    if v_transition then
     if v_complete then
      if v_log is null then
       v_log:=v_snapshot||jsonb_build_object('id',v_log_id,'userId',auth.uid(),'itemId',v_id,'logicalDate',v_date,'manual',false,'completionOperationId',null,'at',p_command->>'at','timezone',v_tz,'revision',0);
      end if;
      if not (v_log->>'manual')::boolean and v_log->>'completionOperationId' is null then v_log:=v_log||v_snapshot||jsonb_build_object('at',p_command->>'at','timezone',v_tz); end if;
      v_log:=v_log||jsonb_build_object('completionOperationId',p_operation,'revision',(v_log->>'revision')::int+1);
     elsif v_log is not null and v_log->>'completionOperationId'=v_item->>'completionOperationId' then
      v_log:=v_log||jsonb_build_object('completionOperationId',null,'revision',(v_log->>'revision')::int+1);
     end if;
     v_item:=v_item||jsonb_build_object('completedAt',case when v_complete then p_command->>'at' else null end,'completionOperationId',case when v_complete then p_operation else null end,'revision',(v_item->>'revision')::int+1);
     v_event_id:=p_operation::text||':'||v_id::text;
     v_event:=v_snapshot||jsonb_build_object('id',v_event_id,'operationId',p_operation,'userId',auth.uid(),'itemId',v_id,'type',case when v_complete then 'completed' else 'reopened' end,'at',p_command->>'at','logicalDate',v_date,'timezone',v_tz,'sequence',(v_item->>'revision')::int);
     insert into public.anti_rotting_events(id,user_id,item_id,operation_id,logical_date,data) values(v_event_id,auth.uid(),v_id,p_operation,v_date,v_event);
    end if;
   end if;
   if v_action='edit' then v_item:=v_item||jsonb_build_object('title',v_title,'notes',v_notes,'itemType',v_type,'revision',(v_item->>'revision')::int+1); end if;
   if v_action='delete' then v_item:=v_item||jsonb_build_object('deletedAt',p_command->>'at','revision',(v_item->>'revision')::int+1); end if;
   if v_action<>'log' then
    v_item:=v_item||jsonb_build_object('updatedAt',p_command->>'at');
    update public.anti_rotting_items set data=v_item where id=v_id and user_id=auth.uid();
   end if;
   if v_action='log' and (p_command->>'logged')::boolean then
    if v_log is null then v_log:=v_snapshot||jsonb_build_object('id',v_log_id,'userId',auth.uid(),'itemId',v_id,'logicalDate',v_date,'manual',false,'completionOperationId',null,'at',p_command->>'at','timezone',v_tz,'revision',0); end if;
    if not (v_log->>'manual')::boolean and v_log->>'completionOperationId' is null then v_log:=v_log||v_snapshot||jsonb_build_object('at',p_command->>'at','timezone',v_tz); end if;
    v_log:=v_log||jsonb_build_object('manual',true,'revision',(v_log->>'revision')::int+1);
   end if;
  end if;
  -- Explicit log removal is allowed even after item deletion.
  if v_action='log' and not (p_command->>'logged')::boolean and v_log is not null then v_log:=v_log||jsonb_build_object('manual',false,'completionOperationId',null,'revision',(v_log->>'revision')::int+1); end if;
  if v_log is not null then
   insert into public.anti_rotting_logs(id,user_id,item_id,logical_date,data) values(v_log_id,auth.uid(),v_id,v_date,v_log)
    on conflict(id) do update set data=excluded.data;
  end if;
  insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'anti:'||v_id::text);
  perform set_config('app180.anti_writer','',true);
 end if;
 return jsonb_build_object(
  'items',coalesce((select jsonb_agg(data) from public.anti_rotting_items where id=v_id and user_id=auth.uid()),'[]'::jsonb),
  'logs',coalesce((select jsonb_agg(data) from public.anti_rotting_logs where item_id=v_id and user_id=auth.uid()),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(data) from public.anti_rotting_events where operation_id=p_operation and user_id=auth.uid()),'[]'::jsonb));
end; $$;
revoke execute on function public.guard_anti_write(),public.apply_anti_operation(uuid,jsonb) from public,anon;
grant execute on function public.guard_anti_write(),public.apply_anti_operation(uuid,jsonb) to authenticated;
