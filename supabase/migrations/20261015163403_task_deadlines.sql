-- Optional root deadlines. No record, history, receipt or daily-work backfill.
alter table public.tasks
  add column due_date date,
  add column due_at timestamptz,
  add constraint task_deadline_exclusive check(due_date is null or due_at is null),
  add constraint task_deadline_roots_only check(parent_id is null or (due_date is null and due_at is null)),
  add constraint task_due_date_range check(due_date is null or due_date between date '0001-01-01' and date '9999-12-31'),
  add constraint task_due_at_range check(due_at is null or due_at between timestamptz '0001-01-01T00:00:00Z' and timestamptz '9999-12-31T23:59:59.999Z');

CREATE OR REPLACE FUNCTION public.apply_task_operation(p_operation uuid, p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  t public.tasks; parent public.tasks; receipt public.operation_receipts;
  entry public.daily_entries; daily_patch jsonb; affected public.task_events;
  task_id uuid; root_id uuid; action text; at_time timestamptz; d date; tz text; complete boolean; task_title text; task_topic text; v_parent_id uuid;
  has_children boolean; all_complete boolean; options_estimated integer; options_priority boolean; options_due_date date; options_due_at timestamptz; deadline jsonb;
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
      if p_command ? 'deadline' then
        deadline:=p_command->'deadline';
        if deadline<>'null'::jsonb then
          if jsonb_typeof(deadline) is distinct from 'object' then raise exception 'Invalid task due date'; end if;
          if deadline ? 'date' and deadline-array['date']='{}'::jsonb then
            if jsonb_typeof(deadline->'date') is distinct from 'string' or (deadline->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid task due date'; end if;
            options_due_date:=(deadline->>'date')::date;
            if options_due_date not between date '0001-01-01' and date '9999-12-31' then raise exception 'Invalid task due date'; end if;
          elsif deadline ? 'at' and deadline-array['at']='{}'::jsonb then
            if jsonb_typeof(deadline->'at') is distinct from 'string' or (deadline->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then raise exception 'Invalid task due time'; end if;
            options_due_at:=(deadline->>'at')::timestamptz;
            if to_char(options_due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>deadline->>'at' or options_due_at not between timestamptz '0001-01-01T00:00:00Z' and timestamptz '9999-12-31T23:59:59.999Z' then raise exception 'Invalid task due time'; end if;
          else raise exception 'Invalid task due date'; end if;
        end if;
      end if;
      if action='options' and not(p_command ? 'estimatedMinutes' or p_command ? 'highPriority' or p_command ? 'deadline') then raise exception 'No task options supplied'; end if;
    end if;
    if action='create' and t.id is null then
      task_title:=btrim(p_command->>'title'); task_topic:=p_command->>'topic'; v_parent_id:=(p_command->>'parentId')::uuid;
      if task_title is null or length(task_title) not between 1 and 500 or task_topic is null or task_topic not in ('school','career','life') then raise exception 'Invalid task title or topic'; end if;
      if v_parent_id is not null then
        select * into parent from public.tasks where id=v_parent_id and user_id=auth.uid();
        if parent.id is null or parent.parent_id is not null or parent.topic<>task_topic then raise exception 'Invalid task parent'; end if;
      end if;
      if v_parent_id is null or parent.deleted_at is null then
        insert into public.tasks(id,user_id,topic,parent_id,title,created_at,updated_at,estimated_minutes,high_priority,due_date,due_at)
          values(task_id,auth.uid(),task_topic,v_parent_id,task_title,at_time,at_time,options_estimated,coalesce(options_priority,false),options_due_date,options_due_at);
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
        if t.parent_id is not null and (options_due_date is not null or options_due_at is not null) then raise exception 'Due dates are available only for top-level tasks'; end if;
        if t.parent_id is not null and coalesce(options_priority,false) then raise exception 'High priority is available only for top-level tasks'; end if;
        update public.tasks set
          estimated_minutes=case when p_command ? 'estimatedMinutes' then options_estimated else t.estimated_minutes end,
          high_priority=case when p_command ? 'highPriority' then options_priority else t.high_priority end,
          due_date=case when p_command ? 'deadline' then options_due_date else t.due_date end,
          due_at=case when p_command ? 'deadline' then options_due_at else t.due_at end,
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
    -- Only new, explicitly requested completion transitions record work. The
    -- derived parent event and deletion-induced transitions are history only.
    if action='complete' and p_command->'recordDaily'='true'::jsonb and t.topic in ('school','career') then
      select * into affected from public.task_events where user_id=auth.uid() and operation_id=p_operation and task_events.task_id=t.id;
      if found then
        if d<'2026-10-09' then raise exception 'Date outside available days'; end if;
        select * into parent from public.tasks where id=root_id and user_id=auth.uid();
        -- Same row lock as apply_entry_patch; merge the current record, never a
        -- stale client snapshot. Tasks, history, daily data and receipt commit together.
        insert into public.daily_entries(user_id,logical_date) values(auth.uid(),d) on conflict do nothing;
        select * into entry from public.daily_entries where user_id=auth.uid() and logical_date=d for update;
        daily_patch:=public.task_daily_patch(entry.data,t.topic,root_id,parent.title,
          case when t.parent_id is not null then t.id end,t.title,affected.event_type='completed',p_operation);
        if daily_patch<>'{}'::jsonb then
          update public.daily_entries set data=data||daily_patch,revision=revision+1,updated_at=clock_timestamp()
            where user_id=auth.uid() and logical_date=d returning * into entry;
        end if;
      end if;
    end if;
    insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'task:'||task_id::text);
  end if;
  return jsonb_build_object(
    -- Read the current entry even on receipt retries or rejected speculative
    -- transitions, so manual corrections survive acknowledgement loss.
    'entry',(select to_jsonb(x) from public.daily_entries x where user_id=auth.uid() and logical_date=d and action='complete' and p_command->'recordDaily'='true'::jsonb and t.topic in ('school','career')),
    'tasks',coalesce((select jsonb_agg(to_jsonb(x)) from public.tasks x where user_id=auth.uid() and (id=root_id or x.parent_id=root_id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_events x where user_id=auth.uid() and operation_id=p_operation),'[]'::jsonb)
  );
end; $function$;
