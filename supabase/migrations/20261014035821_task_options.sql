-- Add optional task metadata; existing completion/history/ownership rules stay intact.
alter table public.tasks
  add column estimated_minutes integer,
  add column high_priority boolean not null default false,
  add constraint task_estimate_range check(estimated_minutes is null or estimated_minutes between 1 and 525600),
  add constraint task_priority_roots_only check(parent_id is null or not high_priority);

CREATE OR REPLACE FUNCTION public.apply_task_operation(p_operation uuid, p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  t public.tasks; parent public.tasks; receipt public.operation_receipts;
  task_id uuid; root_id uuid; action text; at_time timestamptz; d date; tz text; complete boolean; task_title text; task_topic text; v_parent_id uuid;
  has_children boolean; all_complete boolean; options_estimated integer; options_priority boolean;
begin
  if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
  -- One account lock serializes child mutations and derived parent completion across devices.
  perform pg_advisory_xact_lock(hashtextextended('180:tasks:'||auth.uid()::text,0));
  if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Invalid task command'; end if;
  task_id:=(p_command->>'taskId')::uuid; action:=p_command->>'action';
  at_time:=(p_command->>'at')::timestamptz; d:=(p_command->>'logicalDate')::date; tz:=p_command->>'timezone';
  if task_id is null or action is null or action not in ('create','rename','complete','delete','options') or at_time is null or d is null or tz is null then raise exception 'Invalid task command'; end if;
  if not exists(select 1 from pg_timezone_names where name=tz) or d<>((at_time at time zone tz)-interval '2 hours')::date then raise exception 'Invalid task date or timezone'; end if;
  select * into t from public.tasks where id=task_id and user_id=auth.uid();
  root_id:=coalesce(t.parent_id,t.id,(p_command->>'parentId')::uuid,task_id);
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
  if found then
    if receipt.entity_key<>'task:'||task_id::text then raise exception 'Operation ID reused'; end if;
  else
    perform set_config('app180.task_operation',p_operation::text,true);
    perform set_config('app180.task_at',at_time::text,true);
    perform set_config('app180.task_date',d::text,true);
    perform set_config('app180.task_timezone',tz,true);
    if action in ('create','options') then
      if p_command ? 'estimatedMinutes' and p_command->'estimatedMinutes'<>'null'::jsonb then
        if jsonb_typeof(p_command->'estimatedMinutes')<>'number' or (p_command->>'estimatedMinutes') !~ '^[0-9]+$' then raise exception 'Invalid estimated time'; end if;
        if (p_command->>'estimatedMinutes')::numeric not between 1 and 525600 then raise exception 'Invalid estimated time'; end if;
        options_estimated:=(p_command->>'estimatedMinutes')::integer;
      end if;
      if p_command ? 'highPriority' then
        if jsonb_typeof(p_command->'highPriority') is distinct from 'boolean' then raise exception 'Invalid task priority'; end if;
        options_priority:=(p_command->>'highPriority')::boolean;
      end if;
      if action='options' and not(p_command ? 'estimatedMinutes' or p_command ? 'highPriority') then raise exception 'No task options supplied'; end if;
    end if;
    if action='create' and t.id is null then
      task_title:=btrim(p_command->>'title'); task_topic:=p_command->>'topic'; v_parent_id:=(p_command->>'parentId')::uuid;
      if task_title is null or length(task_title) not between 1 and 500 or task_topic is null or task_topic not in ('school','career','life') then raise exception 'Invalid task title or topic'; end if;
      if v_parent_id is not null then
        select * into parent from public.tasks where id=v_parent_id and user_id=auth.uid();
        if parent.id is null or parent.parent_id is not null or parent.topic<>task_topic then raise exception 'Invalid task parent'; end if;
      end if;
      if v_parent_id is null or parent.deleted_at is null then
        insert into public.tasks(id,user_id,topic,parent_id,title,created_at,updated_at,estimated_minutes,high_priority)
          values(task_id,auth.uid(),task_topic,v_parent_id,task_title,at_time,at_time,options_estimated,coalesce(options_priority,false));
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
      elsif action='options' then
        if t.parent_id is not null and coalesce(options_priority,false) then raise exception 'High priority is available only for top-level tasks'; end if;
        update public.tasks set
          estimated_minutes=case when p_command ? 'estimatedMinutes' then options_estimated else t.estimated_minutes end,
          high_priority=case when p_command ? 'highPriority' then options_priority else t.high_priority end,
          updated_at=at_time,revision=revision+1 where id=task_id;
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
end; $function$;
