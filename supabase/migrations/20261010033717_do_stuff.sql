-- Persistent tasks. Archive visibility is derived; tombstones and history are retained.
create table public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  topic text not null check(topic in ('school','career','life')),
  parent_id uuid,
  title text not null check(length(btrim(title)) between 1 and 500),
  completed_at timestamptz,
  deleted_at timestamptz,
  revision bigint not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(user_id,id,topic),
  foreign key(user_id,parent_id,topic) references public.tasks(user_id,id,topic),
  check(parent_id is distinct from id)
);
create index tasks_owner_topic on public.tasks(user_id,topic);
create index tasks_parent on public.tasks(parent_id);
create table public.task_events (
  id text primary key,
  operation_id uuid not null,
  user_id uuid not null references auth.users(id),
  task_id uuid not null,
  parent_id uuid,
  topic text not null check(topic in ('school','career','life')),
  title text not null,
  event_type text not null check(event_type in ('completed','reopened')),
  occurred_at timestamptz not null,
  logical_date date not null,
  timezone text not null,
  unique(user_id,operation_id,task_id),
  foreign key(user_id,task_id,topic) references public.tasks(user_id,id,topic)
);
create index task_events_owner_date on public.task_events(user_id,logical_date);
create index task_events_task on public.task_events(task_id);
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
create policy private_tasks on public.tasks for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy private_task_events_read on public.task_events for select to authenticated using(user_id=(select auth.uid()));
create policy private_task_events_insert on public.task_events for insert to authenticated
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
revoke all on public.tasks,public.task_events from anon,authenticated;
grant select,insert,update on public.tasks to authenticated;
grant select,insert on public.task_events to authenticated;

create function public.validate_task_relation() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.tasks;
begin
  if TG_OP='UPDATE' then
    if (new.id,new.user_id,new.topic,new.parent_id,new.created_at) is distinct from (old.id,old.user_id,old.topic,old.parent_id,old.created_at) then
      raise exception 'Task identity and hierarchy are immutable';
    end if;
    if old.deleted_at is not null and new is distinct from old then raise exception 'Deleted tasks cannot be changed'; end if;
  end if;
  if new.parent_id is not null then
    select * into p from public.tasks where id=new.parent_id and user_id=new.user_id;
    if not found or p.parent_id is not null or p.topic<>new.topic then raise exception 'Invalid task parent'; end if;
    if TG_OP='INSERT' and p.deleted_at is not null then raise exception 'Parent has been deleted'; end if;
  end if;
  return new;
end; $$;
create trigger validate_task_relation before insert or update on public.tasks for each row execute function public.validate_task_relation();

create function public.record_task_transition() returns trigger language plpgsql security invoker set search_path='' as $$
declare op uuid; at_time timestamptz; d date; tz text;
begin
  if (new.completed_at is null) = (old.completed_at is null) then return new; end if;
  op:=nullif(current_setting('180.task_operation',true),'')::uuid;
  at_time:=nullif(current_setting('180.task_at',true),'')::timestamptz;
  d:=nullif(current_setting('180.task_date',true),'')::date;
  tz:=nullif(current_setting('180.task_timezone',true),'');
  if op is null or at_time is null or d is null or tz is null then raise exception 'Use task operation RPC for completion changes'; end if;
  insert into public.task_events(id,operation_id,user_id,task_id,parent_id,topic,title,event_type,occurred_at,logical_date,timezone)
    values(op::text||':'||new.id::text,op,new.user_id,new.id,new.parent_id,new.topic,new.title,
      case when new.completed_at is null then 'reopened' else 'completed' end,at_time,d,tz);
  return new;
end; $$;
create trigger record_task_transition after update on public.tasks for each row execute function public.record_task_transition();

create function public.apply_task_operation(p_operation uuid,p_command jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  t public.tasks; parent public.tasks; receipt public.operation_receipts;
  task_id uuid; root_id uuid; action text; at_time timestamptz; d date; tz text; complete boolean; task_title text; task_topic text; parent_id uuid;
  has_children boolean; all_complete boolean;
begin
  if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
  -- One account lock serializes child mutations and derived parent completion across devices.
  perform pg_advisory_xact_lock(hashtextextended('180:tasks:'||auth.uid()::text,0));
  if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Invalid task command'; end if;
  task_id:=(p_command->>'taskId')::uuid; action:=p_command->>'action';
  at_time:=(p_command->>'at')::timestamptz; d:=(p_command->>'logicalDate')::date; tz:=p_command->>'timezone';
  if task_id is null or action is null or action not in ('create','rename','complete','delete') or at_time is null or d is null or tz is null then raise exception 'Invalid task command'; end if;
  if not exists(select 1 from pg_timezone_names where name=tz) or d<>((at_time at time zone tz)-interval '2 hours')::date then raise exception 'Invalid task date or timezone'; end if;
  select * into t from public.tasks where id=task_id and user_id=auth.uid();
  root_id:=coalesce(t.parent_id,t.id,(p_command->>'parentId')::uuid,task_id);
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
  if found then
    if receipt.entity_key<>'task:'||task_id::text then raise exception 'Operation ID reused'; end if;
  else
    perform set_config('180.task_operation',p_operation::text,true);
    perform set_config('180.task_at',at_time::text,true);
    perform set_config('180.task_date',d::text,true);
    perform set_config('180.task_timezone',tz,true);
    if action='create' and t.id is null then
      task_title:=btrim(p_command->>'title'); task_topic:=p_command->>'topic'; parent_id:=(p_command->>'parentId')::uuid;
      if task_title is null or length(task_title) not between 1 and 500 or task_topic is null or task_topic not in ('school','career','life') then raise exception 'Invalid task title or topic'; end if;
      if parent_id is not null then
        select * into parent from public.tasks where id=parent_id and user_id=auth.uid();
        if parent.id is null or parent.parent_id is not null or parent.topic<>task_topic then raise exception 'Invalid task parent'; end if;
      end if;
      if parent_id is null or parent.deleted_at is null then
        insert into public.tasks(id,user_id,topic,parent_id,title,created_at,updated_at)
          values(task_id,auth.uid(),task_topic,parent_id,task_title,at_time,at_time);
      end if;
    elsif t.id is not null and t.deleted_at is null then
      if action='rename' then
        task_title:=btrim(p_command->>'title');
        if task_title is null or length(task_title) not between 1 and 500 then raise exception 'Invalid task title'; end if;
        update public.tasks set title=task_title,updated_at=at_time,revision=revision+1 where id=task_id;
      elsif action='complete' then
        if jsonb_typeof(p_command->'completed') is distinct from 'boolean' then raise exception 'Invalid completion value'; end if;
        complete:=(p_command->>'completed')::boolean;
        if not exists(select 1 from public.tasks where tasks.parent_id=task_id and deleted_at is null) and (t.completed_at is not null)<>complete then
          update public.tasks set completed_at=case when complete then at_time else null end,updated_at=at_time,revision=revision+1 where id=task_id;
        end if;
      elsif action='delete' then
        update public.tasks set deleted_at=at_time,updated_at=at_time,revision=revision+1 where (id=task_id or tasks.parent_id=task_id) and deleted_at is null;
      end if;
    end if;
    -- Recompute the affected root, including conversion and deletion of the last child.
    if root_id<>task_id then
      select * into parent from public.tasks where id=root_id and user_id=auth.uid();
      if parent.id is not null and parent.deleted_at is null then
        select count(*)>0,coalesce(bool_and(completed_at is not null),false) into has_children,all_complete from public.tasks where tasks.parent_id=root_id and deleted_at is null;
        complete:=has_children and all_complete;
        if (parent.completed_at is not null)<>complete then
          update public.tasks set completed_at=case when complete then at_time else null end,updated_at=at_time,revision=revision+1 where id=root_id;
        end if;
      end if;
    end if;
    insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'task:'||task_id::text);
  end if;
  return jsonb_build_object(
    'tasks',coalesce((select jsonb_agg(to_jsonb(x)) from public.tasks x where user_id=auth.uid() and (id=root_id or x.parent_id=root_id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_events x where user_id=auth.uid() and operation_id=p_operation),'[]'::jsonb)
  );
end; $$;
revoke execute on function public.validate_task_relation(),public.record_task_transition(),public.apply_task_operation(uuid,jsonb) from public,anon;
grant execute on function public.validate_task_relation(),public.record_task_transition(),public.apply_task_operation(uuid,jsonb) to authenticated;

-- Keep old records valid, with strict validation of dated activity snapshots.
alter function public.valid_daily_data(jsonb) rename to valid_daily_data_v1;
create function public.valid_daily_data(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; selection jsonb; child jsonb; legacy jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  legacy:=value-array['schoolTasksStatus','careerTasksStatus','schoolTasksReason','careerTasksReason','schoolTasksWorkedOn','careerTasksWorkedOn'];
  if not public.valid_daily_data_v1(legacy) then return false; end if;
  for k,v in select e.key,e.value from jsonb_each(value) e where e.key=any(array['schoolTasksStatus','careerTasksStatus','schoolTasksReason','careerTasksReason','schoolTasksWorkedOn','careerTasksWorkedOn']) loop
    if k in ('schoolTasksStatus','careerTasksStatus') then
      if jsonb_typeof(v) not in ('boolean','null') then return false; end if;
    elsif k in ('schoolTasksReason','careerTasksReason') then
      if jsonb_typeof(v)<>'string' then return false; end if;
    elsif k in ('schoolTasksWorkedOn','careerTasksWorkedOn') then
      if jsonb_typeof(v)<>'array' then return false; end if;
      for selection in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(selection)<>'object' or not(selection ?& array['taskId','title','children']) or selection-array['taskId','title','children']<>'{}'::jsonb then return false; end if;
        if jsonb_typeof(selection->'taskId')<>'string' or (selection->>'taskId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or jsonb_typeof(selection->'title')<>'string' or length(selection->>'title') not between 1 and 500 or jsonb_typeof(selection->'children')<>'array' then return false; end if;
        for child in select * from jsonb_array_elements(selection->'children') loop
          if jsonb_typeof(child)<>'object' or not(child ?& array['taskId','title']) or child-array['taskId','title']<>'{}'::jsonb then return false; end if;
          if jsonb_typeof(child->'taskId')<>'string' or (child->>'taskId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or jsonb_typeof(child->'title')<>'string' or length(child->>'title') not between 1 and 500 then return false; end if;
        end loop;
      end loop;
    end if;
  end loop;
  return true;
end; $$;
-- Existing constraint follows the renamed function OID, so replace it explicitly.
alter table public.daily_entries drop constraint daily_entries_data_check;
alter table public.daily_entries add constraint daily_entries_data_check check(public.valid_daily_data(data));
revoke execute on function public.valid_daily_data(jsonb) from public,anon;
grant execute on function public.valid_daily_data(jsonb) to authenticated;
