-- Public accounts. Existing records, definitions, receipts and legacy cutovers are retained.
create schema if not exists private;
create table public.account_profiles (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null,
  signup_timezone text not null,
  start_date date not null,
  legacy boolean not null default false,
  onboarding_completed_at timestamptz,
  starter_id text,
  starter_version integer,
  initial_configuration jsonb not null default '{"blocks":[],"items":[],"lists":[]}',
  check(jsonb_typeof(initial_configuration)='object')
);
alter table public.account_profiles enable row level security;
create policy account_profile_read on public.account_profiles for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.account_profiles from anon,authenticated;
grant select on public.account_profiles to authenticated;
insert into public.account_profiles(user_id,created_at,signup_timezone,start_date,legacy,onboarding_completed_at)
  select u.id,u.created_at,'America/New_York',date '2026-10-09',true,u.created_at
  from auth.users u join public.app_owner o on o.user_id=u.id;

-- The backend can be prepared while registration remains closed. Only an
-- administrator opens this after deploying the compatible client and Auth settings.
create table private.registration_settings (singleton boolean primary key default true check(singleton), enabled boolean not null default false);
insert into private.registration_settings(singleton) values(true);
alter table private.registration_settings enable row level security;
revoke all on private.registration_settings from public,anon,authenticated;

create table private.starter_catalog (id text not null, version integer not null, data jsonb not null, primary key(id,version));
alter table private.starter_catalog enable row level security;
revoke all on private.starter_catalog from public,anon,authenticated;

create function private.create_account_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare tz text:=coalesce(new.raw_user_meta_data->>'signup_timezone','UTC');
begin
  if not exists(select 1 from private.registration_settings where enabled) then raise insufficient_privilege using message='Registration is being prepared. Please try again shortly.'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then tz:='UTC'; end if;
  insert into public.account_profiles(user_id,created_at,signup_timezone,start_date)
    values(new.id,new.created_at,tz,((new.created_at at time zone tz)-interval '2 hours')::date);
  return new;
end; $$;
revoke all on function private.create_account_profile() from public,anon,authenticated;
-- Supabase Auth signup stays disabled at rollout until the compatible client is ready.
drop trigger if exists private_account_gate on auth.users;
drop trigger if exists private_owner_assignment on auth.users;
create trigger create_account_profile after insert on auth.users for each row execute function private.create_account_profile();

create function public.account_ready() returns boolean language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.account_profiles where user_id=auth.uid() and onboarding_completed_at is not null)
$$;
create function public.account_start_date() returns date language sql stable security invoker set search_path='' as $$
  select start_date from public.account_profiles where user_id=auth.uid()
$$;
revoke all on function public.account_ready(),public.account_start_date() from public,anon;
grant execute on function public.account_ready(),public.account_start_date() to authenticated;

-- Reuse every existing row ownership boundary; remove only the singleton membership requirement.
do $$
declare p record; expr text;
begin
  for p in select * from pg_policies where schemaname='public' and tablename in
    ('daily_entries','journal_images','operation_receipts','tasks','task_events','anti_rotting_items','anti_rotting_logs','anti_rotting_events','config_changes','custom_answers') loop
    expr:='user_id=(select auth.uid()) and (select public.account_ready())';
    if p.tablename in ('daily_entries','journal_images','custom_answers','anti_rotting_logs','anti_rotting_events','task_events') then expr:=expr||' and logical_date >= (select public.account_start_date())'; end if;
    if p.tablename='config_changes' then expr:=expr||' and effective_date >= (select public.account_start_date())'; end if;
    if p.cmd in ('ALL','UPDATE') then execute format('alter policy %I on public.%I using (%s) with check (%s)',p.policyname,p.tablename,expr,expr);
    elsif p.cmd='SELECT' then execute format('alter policy %I on public.%I using (%s)',p.policyname,p.tablename,expr);
    elsif p.cmd='INSERT' then execute format('alter policy %I on public.%I with check (%s)',p.policyname,p.tablename,expr);
    end if;
  end loop;
  for p in select conname,conrelid::regclass as relation from pg_constraint
    where conrelid in ('public.daily_entries'::regclass,'public.custom_answers'::regclass,'public.config_changes'::regclass)
      and contype='c' and pg_get_constraintdef(oid) like '%2026-10-09%' loop
    execute format('alter table %s drop constraint %I',p.relation,p.conname);
  end loop;
end; $$;

create or replace function public.check_entry_access(p_date date,p_timezone text) returns void language plpgsql security invoker set search_path='' as $$
declare local_today date;
begin
  if not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
  local_today:=greatest(public.account_start_date(),((clock_timestamp() at time zone p_timezone)-interval '2 hours')::date);
  if p_date is null or p_date<public.account_start_date() or p_date>local_today then raise exception 'Date outside available days'; end if;
end; $$;

create or replace function public.customization_config_at(day date,max_revision bigint default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare config jsonb; profile public.account_profiles; change public.config_changes;
begin
  select * into profile from public.account_profiles where user_id=auth.uid();
  if not found or profile.onboarding_completed_at is null then raise insufficient_privilege using message='Account setup required'; end if;
  config:=case when profile.legacy then public.customization_seed_config(day) else profile.initial_configuration end;
  for change in select * from public.config_changes where user_id=auth.uid() and effective_date<=day and (max_revision is null or sequence<=max_revision) order by sequence loop
    config:=public.customization_merge(config,change.patch);
  end loop;
  return config;
end; $$;

create function private.complete_onboarding(p_operation uuid,p_starter text,p_version integer,p_selection jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.account_profiles; template jsonb; config jsonb; entity jsonb; identity uuid; stamp timestamptz:=clock_timestamp(); receipt public.operation_receipts; bucket text; selected jsonb;
begin
  if auth.uid() is null then raise insufficient_privilege using message='Sign in to create your space'; end if;
  select * into profile from public.account_profiles where user_id=auth.uid() for update;
  if not found then raise exception 'Account profile missing'; end if;
  if p_operation is null then raise exception 'Operation ID required'; end if;
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
  if found and receipt.entity_key<>'onboarding' then raise exception 'Operation ID reused'; end if;
  if profile.onboarding_completed_at is not null then return to_jsonb(profile); end if;
  select data into template from private.starter_catalog where id=p_starter and version=p_version;
  if template is null then raise exception 'This starter version is unavailable'; end if;
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection-array['items','lists','tasks','activities']<>'{}'::jsonb then raise exception 'Invalid starter selection'; end if;
  foreach bucket in array array['items','lists','tasks','activities'] loop
    selected:=p_selection->bucket;
    if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected)>100 then raise exception 'Invalid starter selection'; end if;
    if exists(select 1 from jsonb_array_elements(selected) v where jsonb_typeof(v)<>'string') then raise exception 'Invalid starter selection'; end if;
    if (select count(*)<>count(distinct v) from jsonb_array_elements(selected) v) then raise exception 'Duplicate starter selection'; end if;
    if exists(select 1 from jsonb_array_elements_text(selected) v where not exists(select 1 from jsonb_array_elements(case when bucket in ('items','lists') then template->'configuration'->bucket else template->bucket end) e where e->>'id'=v)) then raise exception 'Unknown starter selection'; end if;
  end loop;
  config:=jsonb_build_object('lists',coalesce((select jsonb_agg(e) from jsonb_array_elements(template->'configuration'->'lists') e where p_selection->'lists' ? (e->>'id')),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(e) from jsonb_array_elements(template->'configuration'->'items') e where p_selection->'items' ? (e->>'id')),'[]'::jsonb));
  if exists(select 1 from jsonb_array_elements(config->'items') e where e ? 'listId' and not (p_selection->'lists' ? (e->>'listId'))) or
     exists(select 1 from jsonb_array_elements(template->'tasks') e where p_selection->'tasks' ? (e->>'id') and not (p_selection->'lists' ? (e->>'listId'))) then raise exception 'Select the connected list first'; end if;
  config:=config||jsonb_build_object('blocks',coalesce((select jsonb_agg(e) from jsonb_array_elements(template->'configuration'->'blocks') e where exists(select 1 from jsonb_array_elements(config->'items') i where i->>'blockId'=e->>'id')),'[]'::jsonb));
  perform public.customization_validate_config(config);
  -- No completed work or synthetic daily history is inserted.
  for entity in select * from jsonb_array_elements(template->'tasks') e where p_selection->'tasks' ? (e->>'id') loop
    insert into public.tasks(id,user_id,topic,title,created_at,updated_at) values(gen_random_uuid(),auth.uid(),entity->>'listId',entity->>'title',stamp,stamp);
  end loop;
  perform set_config('app180.anti_writer',auth.uid()::text,true);
  for entity in select * from jsonb_array_elements(template->'activities') e where p_selection->'activities' ? (e->>'id') loop
    identity:=gen_random_uuid();
    insert into public.anti_rotting_items(id,user_id,data) values(identity,auth.uid(),jsonb_build_object(
      'id',identity,'userId',auth.uid(),'title',entity->>'title','notes','','itemType',entity->>'itemType',
      'completedAt',null,'completionOperationId',null,'deletedAt',null,'revision',0,'createdAt',stamp,'updatedAt',stamp));
  end loop;
  update public.account_profiles set initial_configuration=config,onboarding_completed_at=stamp,starter_id=p_starter,starter_version=p_version where user_id=auth.uid() returning * into profile;
  insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'onboarding');
  return to_jsonb(profile);
end; $$;
revoke all on function private.complete_onboarding(uuid,text,integer,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.complete_onboarding(uuid,text,integer,jsonb) to authenticated;
create function public.complete_onboarding(p_operation uuid,p_starter text,p_version integer,p_selection jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.complete_onboarding(p_operation,p_starter,p_version,p_selection) $$;
revoke all on function public.complete_onboarding(uuid,text,integer,jsonb) from public,anon;
grant execute on function public.complete_onboarding(uuid,text,integer,jsonb) to authenticated;

-- Existing storage paths remain account-owned and private.
alter policy journal_read on storage.objects using(bucket_id='journal' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.account_ready()));
alter policy journal_upload on storage.objects with check(bucket_id='journal' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.account_ready()));
alter policy journal_remove on storage.objects using(bucket_id='journal' and (storage.foldername(name))[1]=(select auth.uid())::text and (select public.account_ready()));

insert into private.starter_catalog(id,version,data) select e->>'id',(e->>'version')::integer,e from jsonb_array_elements($catalog$[
  {
    "id": "everyday",
    "version": 1,
    "title": "Everyday",
    "description": "A little structure for your habits and everyday priorities.",
    "configuration": {
      "blocks": [
        {
          "id": "starter-habits",
          "title": "Daily habits",
          "icon": "sun",
          "order": 0
        },
        {
          "id": "starter-tasks",
          "title": "Tasks",
          "icon": "check",
          "order": 1
        }
      ],
      "items": [
        {
          "id": "starter-move",
          "blockId": "starter-habits",
          "label": "Moved my body",
          "kind": "checkbox",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": []
        },
        {
          "id": "starter-learn",
          "blockId": "starter-habits",
          "label": "Read or learned",
          "kind": "duration",
          "generation": 1,
          "order": 1,
          "completion": {
            "op": "compare",
            "field": "value",
            "operator": "gte",
            "value": 10
          },
          "followups": [],
          "min": 0
        },
        {
          "id": "starter-scroll",
          "blockId": "starter-habits",
          "label": "Time spent scrolling",
          "kind": "duration",
          "generation": 1,
          "order": 2,
          "completion": {
            "op": "compare",
            "field": "value",
            "operator": "lte",
            "value": 60
          },
          "followups": [],
          "min": 0
        },
        {
          "id": "starter-offline",
          "blockId": "starter-habits",
          "label": "Enjoyed an offline activity",
          "kind": "checkbox",
          "generation": 1,
          "order": 3,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": []
        },
        {
          "id": "starter-personal-work",
          "blockId": "starter-tasks",
          "label": "Worked on Personal tasks?",
          "kind": "tasks",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "listId": "starter-personal",
          "visibility": "relevant"
        },
        {
          "id": "starter-life-work",
          "blockId": "starter-tasks",
          "label": "Worked on Life tasks?",
          "kind": "tasks",
          "generation": 1,
          "order": 1,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "listId": "starter-life",
          "visibility": "relevant"
        }
      ],
      "lists": [
        {
          "id": "starter-personal",
          "title": "Personal",
          "icon": "star",
          "order": 0
        },
        {
          "id": "starter-life",
          "title": "Life",
          "icon": "home",
          "order": 1
        }
      ]
    },
    "tasks": [
      {
        "id": "goal",
        "listId": "starter-personal",
        "title": "Choose a goal for this week"
      },
      {
        "id": "tomorrow",
        "listId": "starter-life",
        "title": "Plan tomorrow"
      },
      {
        "id": "tidy",
        "listId": "starter-life",
        "title": "Tidy a small area"
      }
    ],
    "activities": [
      {
        "id": "walk",
        "title": "Take a short walk",
        "itemType": "reusable"
      },
      {
        "id": "read",
        "title": "Read a chapter",
        "itemType": "reusable"
      },
      {
        "id": "hobby",
        "title": "Practice a hobby for ten minutes",
        "itemType": "reusable"
      },
      {
        "id": "tidy",
        "title": "Tidy one small area",
        "itemType": "reusable"
      },
      {
        "id": "topic",
        "title": "Explore a topic you’re curious about",
        "itemType": "reusable"
      },
      {
        "id": "visit",
        "title": "Find a new place to visit",
        "itemType": "one-time"
      }
    ]
  },
  {
    "id": "student",
    "version": 1,
    "title": "Student",
    "description": "Make room for study, classes and life outside school.",
    "configuration": {
      "blocks": [
        {
          "id": "starter-habits",
          "title": "Daily habits",
          "icon": "sun",
          "order": 0
        },
        {
          "id": "starter-school",
          "title": "School",
          "icon": "book",
          "order": 1
        },
        {
          "id": "starter-personal",
          "title": "Personal",
          "icon": "star",
          "order": 2
        }
      ],
      "items": [
        {
          "id": "starter-move",
          "blockId": "starter-habits",
          "label": "Moved my body",
          "kind": "checkbox",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": []
        },
        {
          "id": "starter-scroll",
          "blockId": "starter-habits",
          "label": "Time spent scrolling",
          "kind": "duration",
          "generation": 1,
          "order": 1,
          "completion": {
            "op": "compare",
            "field": "value",
            "operator": "lte",
            "value": 60
          },
          "followups": [],
          "min": 0
        },
        {
          "id": "starter-study",
          "blockId": "starter-school",
          "label": "Studied",
          "kind": "duration",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "compare",
            "field": "value",
            "operator": "gte",
            "value": 25
          },
          "followups": [],
          "min": 0
        },
        {
          "id": "starter-class",
          "blockId": "starter-school",
          "label": "Attended class",
          "kind": "boolean",
          "generation": 1,
          "order": 1,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "schedule": {
            "weekdays": [1, 2, 3, 4, 5]
          }
        },
        {
          "id": "starter-school-work",
          "blockId": "starter-school",
          "label": "Worked on School tasks?",
          "kind": "tasks",
          "generation": 1,
          "order": 2,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "listId": "starter-school",
          "visibility": "relevant"
        },
        {
          "id": "starter-personal-work",
          "blockId": "starter-personal",
          "label": "Worked on Personal tasks?",
          "kind": "tasks",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "listId": "starter-personal",
          "visibility": "relevant"
        }
      ],
      "lists": [
        {
          "id": "starter-school",
          "title": "School",
          "icon": "book",
          "order": 0
        },
        {
          "id": "starter-personal",
          "title": "Personal",
          "icon": "star",
          "order": 1
        }
      ]
    },
    "tasks": [
      {
        "id": "assignment",
        "listId": "starter-school",
        "title": "Review your next assignment"
      },
      {
        "id": "study",
        "listId": "starter-school",
        "title": "Plan a study session"
      },
      {
        "id": "enjoy",
        "listId": "starter-personal",
        "title": "Plan something you enjoy"
      }
    ],
    "activities": [
      {
        "id": "walk",
        "title": "Take a short walk",
        "itemType": "reusable"
      },
      {
        "id": "read",
        "title": "Read a chapter",
        "itemType": "reusable"
      },
      {
        "id": "hobby",
        "title": "Practice a hobby for ten minutes",
        "itemType": "reusable"
      },
      {
        "id": "tidy",
        "title": "Tidy one small area",
        "itemType": "reusable"
      },
      {
        "id": "topic",
        "title": "Explore a topic you’re curious about",
        "itemType": "reusable"
      },
      {
        "id": "visit",
        "title": "Find a new place to visit",
        "itemType": "one-time"
      }
    ]
  },
  {
    "id": "work",
    "version": 1,
    "title": "Work & projects",
    "description": "Keep your priorities moving while making time for yourself.",
    "configuration": {
      "blocks": [
        {
          "id": "starter-habits",
          "title": "Daily habits",
          "icon": "sun",
          "order": 0
        },
        {
          "id": "starter-work",
          "title": "Work",
          "icon": "briefcase",
          "order": 1
        },
        {
          "id": "starter-personal",
          "title": "Personal",
          "icon": "star",
          "order": 2
        }
      ],
      "items": [
        {
          "id": "starter-move",
          "blockId": "starter-habits",
          "label": "Moved my body",
          "kind": "checkbox",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": []
        },
        {
          "id": "starter-learn",
          "blockId": "starter-habits",
          "label": "Read or learned",
          "kind": "duration",
          "generation": 1,
          "order": 1,
          "completion": {
            "op": "compare",
            "field": "value",
            "operator": "gte",
            "value": 10
          },
          "followups": [],
          "min": 0
        },
        {
          "id": "starter-scroll",
          "blockId": "starter-habits",
          "label": "Time spent scrolling",
          "kind": "duration",
          "generation": 1,
          "order": 2,
          "completion": {
            "op": "compare",
            "field": "value",
            "operator": "lte",
            "value": 60
          },
          "followups": [],
          "min": 0
        },
        {
          "id": "starter-priorities",
          "blockId": "starter-work",
          "label": "Planned my priorities",
          "kind": "checkbox",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": []
        },
        {
          "id": "starter-work-work",
          "blockId": "starter-work",
          "label": "Worked on Work tasks?",
          "kind": "tasks",
          "generation": 1,
          "order": 1,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "listId": "starter-work",
          "visibility": "relevant"
        },
        {
          "id": "starter-personal-work",
          "blockId": "starter-personal",
          "label": "Worked on Personal tasks?",
          "kind": "tasks",
          "generation": 1,
          "order": 0,
          "completion": {
            "op": "equals",
            "field": "value",
            "value": true
          },
          "followups": [],
          "listId": "starter-personal",
          "visibility": "relevant"
        }
      ],
      "lists": [
        {
          "id": "starter-work",
          "title": "Work",
          "icon": "briefcase",
          "order": 0
        },
        {
          "id": "starter-personal",
          "title": "Personal",
          "icon": "star",
          "order": 1
        }
      ]
    },
    "tasks": [
      {
        "id": "priority",
        "listId": "starter-work",
        "title": "Choose this week’s main priority"
      },
      {
        "id": "next",
        "listId": "starter-work",
        "title": "Break a project into its next step"
      },
      {
        "id": "outside",
        "listId": "starter-personal",
        "title": "Plan something outside work"
      }
    ],
    "activities": [
      {
        "id": "walk",
        "title": "Take a short walk",
        "itemType": "reusable"
      },
      {
        "id": "read",
        "title": "Read a chapter",
        "itemType": "reusable"
      },
      {
        "id": "hobby",
        "title": "Practice a hobby for ten minutes",
        "itemType": "reusable"
      },
      {
        "id": "tidy",
        "title": "Tidy one small area",
        "itemType": "reusable"
      },
      {
        "id": "topic",
        "title": "Explore a topic you’re curious about",
        "itemType": "reusable"
      },
      {
        "id": "visit",
        "title": "Find a new place to visit",
        "itemType": "one-time"
      }
    ]
  },
  {
    "id": "blank",
    "version": 1,
    "title": "Start from scratch",
    "description": "An empty space to build your own way.",
    "configuration": {
      "blocks": [],
      "items": [],
      "lists": []
    },
    "tasks": [],
    "activities": []
  }
]
$catalog$::jsonb) e;

-- Preserve the existing operation contract, receipt IDs and merge behavior.
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
  link jsonb; config jsonb; definition jsonb; block jsonb; answer public.custom_answers; answer_patch jsonb; source jsonb; saved_link jsonb; configuration_revision bigint; answer_generation integer;
begin
  if auth.uid() is null or not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('180:customization:'||auth.uid()::text,0));
  -- One account lock serializes child mutations and derived parent completion across devices.
  perform pg_advisory_xact_lock(hashtextextended('180:tasks:'||auth.uid()::text,0));
  if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Invalid task command'; end if;
  task_id:=(p_command->>'taskId')::uuid; action:=p_command->>'action';
  at_time:=(p_command->>'at')::timestamptz; d:=(p_command->>'logicalDate')::date; tz:=p_command->>'timezone';
  if task_id is null or action is null or action not in ('create','rename','complete','delete','options') or at_time is null or d is null or tz is null then raise exception 'Invalid task command'; end if;
  if not exists(select 1 from pg_timezone_names where name=tz) or d<>greatest(public.account_start_date(),((at_time at time zone tz)-interval '2 hours')::date) then raise exception 'Invalid task date or timezone'; end if;
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
      if task_title is null or length(task_title) not between 1 and 500 or not public.customization_valid_id(task_topic) or (not (exists(select 1 from public.account_profiles where user_id=auth.uid() and legacy) and task_topic in ('school','career','life')) and not exists(select 1 from jsonb_array_elements(public.customization_config_at(d)->'lists') l where l->>'id'=task_topic)) then raise exception 'Invalid task title or topic'; end if;
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
        if d<public.account_start_date() then raise exception 'Date outside available days'; end if;
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
    if daily_patch is not null and daily_patch<>'{}'::jsonb then perform public.customization_refresh_legacy_answers(d,daily_patch); end if;
    if action='complete' and p_command ? 'checklistLink' and p_command->'checklistLink'<>'null'::jsonb then
      link:=p_command->'checklistLink';
      if jsonb_typeof(link) is distinct from 'object' or not(link ?& array['itemId','generation','listId','configurationRevision'])
        or link-array['itemId','generation','listId','configurationRevision']<>'{}'::jsonb
        or not public.customization_valid_id(link->>'itemId') or not public.customization_valid_id(link->>'listId')
        or jsonb_typeof(link->'generation') is distinct from 'number' or link->>'generation' !~ '^[0-9]+$'
        or jsonb_typeof(link->'configurationRevision') is distinct from 'number' or link->>'configurationRevision' !~ '^[0-9]+$' then raise exception 'Invalid checklist binding'; end if;
      answer_generation:=(link->>'generation')::integer; configuration_revision:=(link->>'configurationRevision')::bigint;
      if configuration_revision>(select coalesce(max(sequence),0) from public.config_changes where user_id=auth.uid()) then raise exception 'Unknown configuration revision'; end if;
      config:=public.customization_config_at(d,configuration_revision);
      select i into definition from jsonb_array_elements(config->'items') i where i->>'id'=link->>'itemId';
      select b into block from jsonb_array_elements(config->'blocks') b where b->>'id'=definition->>'blockId';
      if definition is null or definition->>'kind'<>'tasks' or (definition->>'generation')::integer<>answer_generation
        or definition->>'listId'<>link->>'listId' or t.topic<>link->>'listId' or definition->'deleted'='true'::jsonb or block is null or block->'deleted'='true'::jsonb
        or not exists(select 1 from jsonb_array_elements(config->'lists') l where l->>'id'=link->>'listId' and l->'deleted' is distinct from 'true'::jsonb)
        then raise exception 'Checklist binding does not match the saved configuration'; end if;
      saved_link:=link;
      if public.customization_scheduled(nullif(definition->'schedule','null'::jsonb),d) and public.customization_scheduled(nullif(block->'schedule','null'::jsonb),d) then
        select * into affected from public.task_events where user_id=auth.uid() and operation_id=p_operation and task_events.task_id=t.id;
        if found then
          select * into parent from public.tasks where id=root_id and user_id=auth.uid();
          perform pg_advisory_xact_lock(hashtextextended('180:'||auth.uid()::text||':custom-answer:'||d::text||':'||(link->>'itemId')||':'||answer_generation::text,0));
          select * into answer from public.custom_answers where user_id=auth.uid() and logical_date=d and item_id=link->>'itemId' and generation=answer_generation for update;
          source:=coalesce(answer.value,public.customization_legacy_answer(link->>'itemId',answer_generation,coalesce((select data from public.daily_entries where user_id=auth.uid() and logical_date=d),'{}'::jsonb)));
          answer_patch:=public.task_daily_patch(jsonb_build_object('schoolTasksWorkedOn',source->'selections'),'school',root_id,parent.title,
            case when t.parent_id is not null then t.id end,t.title,affected.event_type='completed',p_operation);
          if answer_patch<>'{}'::jsonb then
            answer_patch:=jsonb_build_object('value',answer_patch->'schoolTasksStatus','selections',answer_patch->'schoolTasksWorkedOn');
            insert into public.custom_answers(user_id,logical_date,item_id,generation,value)
              values(auth.uid(),d,link->>'itemId',answer_generation,public.customization_merge_answer(source,answer_patch,answer_generation))
              on conflict(user_id,logical_date,item_id,generation) do update set value=excluded.value;
          end if;
        end if;
      end if;
    end if;
    insert into public.operation_receipts(user_id,operation_id,entity_key,context) values(auth.uid(),p_operation,'task:'||task_id::text,case when saved_link is null then '{}'::jsonb else jsonb_build_object('checklistLink',saved_link) end);
  end if;
  if receipt.operation_id is not null then saved_link:=receipt.context->'checklistLink'; end if;
  return jsonb_build_object(
    'custom_answers',coalesce((select jsonb_agg(to_jsonb(a)) from public.custom_answers a where a.user_id=auth.uid() and a.logical_date=d and a.item_id=saved_link->>'itemId' and a.generation=(saved_link->>'generation')::integer),case when saved_link is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('user_id',auth.uid(),'logical_date',d,'item_id',saved_link->>'itemId','generation',(saved_link->>'generation')::integer,'value',public.customization_legacy_answer(saved_link->>'itemId',(saved_link->>'generation')::integer,coalesce((select data from public.daily_entries where user_id=auth.uid() and logical_date=d),'{}'::jsonb)),'revision',0,'created_at',at_time,'updated_at',at_time)) end),
    -- Read the current entry even on receipt retries or rejected speculative
    -- transitions, so manual corrections survive acknowledgement loss.
    'entry',(select to_jsonb(x) from public.daily_entries x where user_id=auth.uid() and logical_date=d and action='complete' and p_command->'recordDaily'='true'::jsonb and t.topic in ('school','career')),
    'tasks',coalesce((select jsonb_agg(to_jsonb(x)) from public.tasks x where user_id=auth.uid() and (id=root_id or x.parent_id=root_id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_events x where user_id=auth.uid() and operation_id=p_operation),'[]'::jsonb)
  );
end; $function$;

-- Preserve the existing operation contract, receipt IDs and merge behavior.
create or replace function public.apply_anti_operation(p_operation uuid,p_command jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_id uuid; v_action text; v_at timestamptz; v_date date; v_tz text; v_item jsonb; v_log jsonb;
 v_log_id text; v_title text; v_notes text; v_type text; v_complete boolean; v_transition boolean := false;
 v_snapshot jsonb; v_event jsonb; v_event_id text; v_receipt public.operation_receipts;
begin
 if auth.uid() is null or not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('180:anti:'||auth.uid()::text,0));
 if p_operation is null or jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Invalid activity command'; end if;
 v_id:=(p_command->>'itemId')::uuid; v_action:=p_command->>'action'; v_at:=(p_command->>'at')::timestamptz; v_date:=(p_command->>'logicalDate')::date; v_tz:=p_command->>'timezone';
 if v_id is null or v_action is null or v_action not in ('create','edit','log','complete','delete') or v_at is null or v_date is null or v_tz is null then raise exception 'Invalid activity command'; end if;
 if not exists(select 1 from pg_timezone_names where name=v_tz) or v_date<>greatest(public.account_start_date(),((v_at at time zone v_tz)-interval '2 hours')::date) then raise exception 'Invalid activity date or timezone'; end if;
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

-- Preserve the existing operation contract, receipt IDs and merge behavior.
create or replace function public.guard_config_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actual bigint; highest_generation integer; day date; config jsonb; entity jsonb; prior jsonb; next_item jsonb; followup jsonb; previous_followup jsonb;
begin
  if tg_op<>'INSERT' then raise exception 'Configuration revisions are immutable'; end if;
  if auth.uid() is null or new.user_id<>auth.uid() or not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
  if new.effective_date<public.account_start_date() then raise exception 'Date outside available days'; end if;
  if tg_when='BEFORE' then
    perform pg_advisory_xact_lock(hashtextextended('180:customization:'||auth.uid()::text,0));
    select coalesce(max(sequence),0) into actual from public.config_changes where user_id=auth.uid();
    if new.base_revision<>actual then raise exception using errcode='40001',message='Configuration changed on another device',detail=jsonb_build_object('expectedRevision',new.base_revision,'actualRevision',actual)::text; end if;
    if not public.customization_valid_patch(new.patch) then raise exception 'Invalid configuration patch'; end if;
    config:=public.customization_config_at(new.effective_date);
    for entity in select * from jsonb_array_elements(coalesce(new.patch->'items','[]'::jsonb)) loop
      select i into prior from jsonb_array_elements(config->'items') i where i->>'id'=entity->>'id';
      if prior is null then continue; end if;
      next_item:=prior||entity;
      if (next_item->>'generation')::integer<(prior->>'generation')::integer then raise exception 'Answer generations cannot decrease'; end if;
      if (next_item->>'generation')::integer>(prior->>'generation')::integer then
        select greatest((prior->>'generation')::integer,coalesce(max((i->>'generation')::integer),0)) into highest_generation
          from public.config_changes c cross join lateral jsonb_array_elements(coalesce(c.patch->'items','[]'::jsonb)) i
          where c.user_id=auth.uid() and i->>'id'=entity->>'id';
        if (next_item->>'generation')::integer<=highest_generation then raise exception 'This answer generation was already allocated; use a newer generation'; end if;
      end if;
      if next_item->>'kind'<>prior->>'kind' and (next_item->>'generation')::integer<=(prior->>'generation')::integer then raise exception 'An input type change needs a new answer generation'; end if;
      if prior->>'kind'='tasks' and next_item->>'kind'='tasks' and next_item->>'listId' is distinct from prior->>'listId' and (next_item->>'generation')::integer<=(prior->>'generation')::integer then raise exception 'A list binding change needs a new answer generation'; end if;
      if prior->>'kind'='choice' and next_item->>'kind'='choice' and (next_item->>'generation')::integer<=(prior->>'generation')::integer
        and exists(select 1 from jsonb_array_elements(coalesce(prior->'options','[]'::jsonb)) old_option where not exists(select 1 from jsonb_array_elements(coalesce(nullif(next_item->'options','null'::jsonb),'[]'::jsonb)) new_option where new_option->>'id'=old_option->>'id')) then raise exception 'Removing a choice needs a new answer generation'; end if;
      for followup in select * from jsonb_array_elements(next_item->'followups') loop
        select f into previous_followup from jsonb_array_elements(prior->'followups') f where f->>'id'=followup->>'id';
        if previous_followup is not null and previous_followup->>'kind'<>followup->>'kind' and (next_item->>'generation')::integer<=(prior->>'generation')::integer then raise exception 'A follow-up type change needs a new answer generation'; end if;
        if previous_followup->>'kind'='choice' and followup->>'kind'='choice' and (next_item->>'generation')::integer<=(prior->>'generation')::integer
          and exists(select 1 from jsonb_array_elements(coalesce(previous_followup->'options','[]'::jsonb)) old_option where not exists(select 1 from jsonb_array_elements(coalesce(followup->'options','[]'::jsonb)) new_option where new_option->>'id'=old_option->>'id')) then raise exception 'Removing a follow-up choice needs a new answer generation'; end if;
      end loop;
    end loop;
    new.sequence:=actual+1; new.revision:=actual+1; new.created_at:=clock_timestamp();
    return new;
  end if;
  for day in select new.effective_date union select effective_date from public.config_changes where user_id=auth.uid() and effective_date>new.effective_date loop
    perform public.customization_validate_config(public.customization_config_at(day));
  end loop;
  return new;
end; $$;

-- Preserve the existing operation contract, receipt IDs and merge behavior.
create or replace function public.apply_customization_operation(p_operation_id uuid,p_effective_date date,p_base_revision bigint,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare change public.config_changes; receipt public.operation_receipts; actual bigint;
begin
  if auth.uid() is null or not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
  if p_operation_id is null or p_effective_date is null or p_base_revision is null then raise exception 'Invalid configuration operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('180:customization:'||auth.uid()::text,0));
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.entity_key<>'configuration' then raise exception 'Operation ID reused'; end if;
    select * into change from public.config_changes where user_id=auth.uid() and operation_id=p_operation_id;
  else
    insert into public.config_changes(operation_id,user_id,effective_date,sequence,base_revision,patch,revision)
      values(p_operation_id,auth.uid(),p_effective_date,0,p_base_revision,p_patch,0) returning * into change;
    insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation_id,'configuration');
  end if;
  select coalesce(max(sequence),0) into actual from public.config_changes where user_id=auth.uid();
  return jsonb_build_object('change',to_jsonb(change),'revision',actual);
end; $$;

-- Preserve the existing operation contract, receipt IDs and merge behavior.
create or replace function public.guard_custom_answer() returns trigger language plpgsql security invoker set search_path='' as $$
declare definition jsonb; retained_definition jsonb; retained_field jsonb; field text; rev bigint;
begin
  if auth.uid() is null or new.user_id<>auth.uid() or not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
  if new.logical_date<public.account_start_date() then raise exception 'Date outside available days'; end if;
  if tg_op='UPDATE' and (new.user_id,new.logical_date,new.item_id,new.generation,new.created_at) is distinct from (old.user_id,old.logical_date,old.item_id,old.generation,old.created_at) then raise exception 'Answer identity is immutable'; end if;
  definition:=public.customization_item_at(new.item_id,new.generation,new.logical_date);
  -- Removing a follow-up hides its input; it does not discard saved notes or
  -- make every later answer edit invalid. Validate retained fields against their
  -- original same-generation schema, rather than accepting arbitrary extra JSON.
  for field in select jsonb_object_keys(new.value->'fields') loop
    if exists(select 1 from jsonb_array_elements(coalesce(definition->'followups','[]'::jsonb)) f where f->>'id'=field) then continue; end if;
    for rev in select sequence from public.config_changes where user_id=auth.uid() and effective_date<=new.logical_date union select 0 order by 1 desc loop
      select i into retained_definition from jsonb_array_elements(public.customization_config_at(new.logical_date,rev)->'items') i where i->>'id'=new.item_id and (i->>'generation')::integer=new.generation;
      select f into retained_field from jsonb_array_elements(coalesce(retained_definition->'followups','[]'::jsonb)) f where f->>'id'=field;
      if retained_field is not null then
        definition:=jsonb_set(definition,'{followups}',definition->'followups'||jsonb_build_array(retained_field));
        exit;
      end if;
    end loop;
  end loop;
  if public.customization_valid_answer(new.value,definition) is not true then raise exception 'Invalid item answer'; end if;
  new.revision:=case when tg_op='UPDATE' then old.revision+1 else 1 end;
  new.updated_at:=clock_timestamp();
  if tg_op='INSERT' then new.created_at:=new.updated_at; end if;
  return new;
end; $$;

-- Preserve the existing operation contract, receipt IDs and merge behavior.
create or replace function public.apply_custom_answer_operation(p_operation_id uuid,p_logical_date date,p_item_id text,p_generation integer,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer public.custom_answers; receipt public.operation_receipts; entity text; source jsonb;
begin
  if auth.uid() is null or not public.account_ready() then raise insufficient_privilege using message='Account setup required'; end if;
  if p_operation_id is null or p_logical_date is null or not public.customization_valid_id(p_item_id) or p_generation is null or jsonb_typeof(p_patch) is distinct from 'object' or p_patch-array['value','fields','selections']<>'{}'::jsonb or (p_patch ? 'fields' and jsonb_typeof(p_patch->'fields') is distinct from 'object') then raise exception 'Invalid answer patch'; end if;
  entity:='custom-answer:'||p_logical_date::text||':'||p_item_id||':'||p_generation::text;
  perform pg_advisory_xact_lock(hashtextextended('180:customization:'||auth.uid()::text,0));
  perform pg_advisory_xact_lock(hashtextextended('180:'||auth.uid()::text||':'||entity,0));
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation_id;
  if found and receipt.entity_key<>entity then raise exception 'Operation ID reused'; end if;
  select * into answer from public.custom_answers where user_id=auth.uid() and logical_date=p_logical_date and item_id=p_item_id and generation=p_generation for update;
  if receipt.operation_id is not null then return to_jsonb(answer); end if;
  source:=coalesce(answer.value,public.customization_legacy_answer(p_item_id,p_generation,coalesce((select data from public.daily_entries where user_id=auth.uid() and logical_date=p_logical_date),'{}'::jsonb)));
  insert into public.custom_answers(user_id,logical_date,item_id,generation,value)
    values(auth.uid(),p_logical_date,p_item_id,p_generation,public.customization_merge_answer(source,p_patch,p_generation))
    on conflict(user_id,logical_date,item_id,generation) do update set value=excluded.value returning * into answer;
  perform public.customization_bridge_answer(p_logical_date,p_item_id,p_generation,p_patch);
  insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation_id,entity);
  return to_jsonb(answer);
end; $$;
