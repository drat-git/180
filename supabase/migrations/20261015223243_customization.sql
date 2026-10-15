-- Additive, account-owned customization. Legacy entries, operations, topics and
-- completion history keep their identities and remain readable by older clients.
create table public.config_changes (
  operation_id uuid primary key,
  user_id uuid not null references auth.users(id),
  effective_date date not null check(effective_date >= date '2026-10-09'),
  sequence bigint not null,
  base_revision bigint not null check(base_revision >= 0),
  patch jsonb not null,
  created_at timestamptz not null default now(),
  revision bigint not null,
  unique(user_id,sequence)
);
create index config_changes_owner_date on public.config_changes(user_id,effective_date,sequence);
create table public.custom_answers (
  user_id uuid not null references auth.users(id),
  logical_date date not null check(logical_date >= date '2026-10-09'),
  item_id text not null,
  generation integer not null check(generation between 1 and 1000000),
  value jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,logical_date,item_id,generation)
);
-- Receipt context records the original binding; a retry cannot redirect work.
alter table public.operation_receipts add column context jsonb not null default '{}';
alter table public.config_changes enable row level security;
alter table public.custom_answers enable row level security;
create policy private_configuration_read on public.config_changes for select to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy private_configuration_insert on public.config_changes for insert to authenticated
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
create policy private_custom_answers on public.custom_answers for all to authenticated
  using(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())))
  with check(user_id=(select auth.uid()) and exists(select 1 from public.app_owner where user_id=(select auth.uid())));
revoke all on public.config_changes,public.custom_answers from public,anon,authenticated;
grant select,insert on public.config_changes to authenticated;
grant select,insert,update on public.custom_answers to authenticated;

create function public.customization_valid_id(value text) returns boolean
language sql immutable security invoker set search_path='' as $$
  select value is not null and length(value) between 1 and 160 and value ~ '^[A-Za-z0-9:_-]+$'
$$;

create function public.customization_valid_options(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare option jsonb; ids text[]:='{}';
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>100 then return false; end if;
  for option in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(option) is distinct from 'object' or option-array['id','label']<>'{}'::jsonb
      or not public.customization_valid_id(option->>'id') or option->>'id'=any(ids)
      or jsonb_typeof(option->'label') is distinct from 'string' or length(btrim(option->>'label')) not between 1 and 500 then return false; end if;
    ids:=array_append(ids,option->>'id');
  end loop;
  return true;
end; $$;

create function public.customization_valid_schedule(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare day jsonb; first date; last date;
begin
  if jsonb_typeof(value) is distinct from 'object' or value-array['weekdays','startDate','endDate']<>'{}'::jsonb then return false; end if;
  if value ? 'weekdays' then
    if jsonb_typeof(value->'weekdays') is distinct from 'array' or jsonb_array_length(value->'weekdays')>7 then return false; end if;
    for day in select * from jsonb_array_elements(value->'weekdays') loop
      if jsonb_typeof(day) is distinct from 'number' or day::text !~ '^[0-6]$' then return false; end if;
    end loop;
    if (select count(*)<>count(distinct d) from jsonb_array_elements(value->'weekdays') d) then return false; end if;
  end if;
  if value ? 'startDate' then
    if jsonb_typeof(value->'startDate') is distinct from 'string' or value->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    first:=(value->>'startDate')::date;
  end if;
  if value ? 'endDate' then
    if jsonb_typeof(value->'endDate') is distinct from 'string' or value->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    last:=(value->>'endDate')::date;
  end if;
  return first is null or last is null or first<=last;
exception when others then return false;
end; $$;

create function public.customization_scheduled(schedule jsonb, day date) returns boolean
language sql immutable security invoker set search_path='' as $$
  select schedule is null or (
    (not(schedule ? 'startDate') or day >= (schedule->>'startDate')::date)
    and (not(schedule ? 'endDate') or day <= (schedule->>'endDate')::date)
    and (not(schedule ? 'weekdays') or schedule->'weekdays' @> to_jsonb(extract(dow from day)::integer))
  )
$$;

create function public.customization_valid_rule(value jsonb, depth integer default 0) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare child jsonb; operation text;
begin
  if depth>8 or jsonb_typeof(value) is distinct from 'object' then return false; end if;
  operation:=value->>'op';
  if operation in ('always','never') then return value-array['op']='{}'::jsonb;
  elsif operation='complete' then return value-array['op','value']='{}'::jsonb and jsonb_typeof(value->'value')='boolean';
  elsif operation in ('equals','not-empty','compare') then
    if not public.customization_valid_id(value->>'field') then return false; end if;
    if operation='not-empty' then return value-array['op','field']='{}'::jsonb;
    elsif operation='equals' then return value-array['op','field','value']='{}'::jsonb and jsonb_typeof(value->'value') in ('boolean','string','number','null');
    else return value-array['op','field','operator','value']='{}'::jsonb and value->>'operator' in ('lt','lte','eq','gte','gt') and jsonb_typeof(value->'value')='number'; end if;
  elsif operation='not' then return value-array['op','rule']='{}'::jsonb and public.customization_valid_rule(value->'rule',depth+1);
  elsif operation in ('all','any') then
    if value-array['op','rules']<>'{}'::jsonb or jsonb_typeof(value->'rules') is distinct from 'array' or jsonb_array_length(value->'rules')>50 then return false; end if;
    for child in select * from jsonb_array_elements(value->'rules') loop if not public.customization_valid_rule(child,depth+1) then return false; end if; end loop;
    return true;
  end if;
  return false;
end; $$;

create function public.customization_valid_patch(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare bucket text; entity jsonb; key text; field jsonb; followup jsonb; ids text[];
begin
  if jsonb_typeof(value) is distinct from 'object' or value-array['blocks','items','lists']<>'{}'::jsonb or length(value::text)>1000000 then return false; end if;
  for bucket in select jsonb_object_keys(value) loop
    if jsonb_typeof(value->bucket) is distinct from 'array' or jsonb_array_length(value->bucket)>2000 then return false; end if;
    ids:='{}';
    for entity in select * from jsonb_array_elements(value->bucket) loop
      if jsonb_typeof(entity) is distinct from 'object' or not public.customization_valid_id(entity->>'id') or entity->>'id'=any(ids) then return false; end if;
      ids:=array_append(ids,entity->>'id');
      if bucket in ('blocks','lists') and entity-array['id','title','icon','order','deleted','schedule']<>'{}'::jsonb then return false; end if;
      if bucket='lists' and entity ? 'schedule' then return false; end if;
      if bucket='items' and entity-array['id','blockId','label','kind','generation','order','schedule','helper','inputId','completion','followups','legacyKey','listId','visibility','options','min','max','step','deleted']<>'{}'::jsonb then return false; end if;
      for key,field in select * from jsonb_each(entity) loop
        if field='null'::jsonb and key in ('schedule','helper','inputId','legacyKey','listId','visibility','options','min','max','step') then continue; end if;
        if key in ('blockId','listId') and not public.customization_valid_id(field#>>'{}') then return false;
        elsif key in ('title','label') and (jsonb_typeof(field) is distinct from 'string' or length(btrim(field#>>'{}')) not between 1 and 500) then return false;
        elsif key in ('icon','legacyKey') and (jsonb_typeof(field) is distinct from 'string' or length(field#>>'{}')>100) then return false;
        elsif key='helper' and (jsonb_typeof(field) is distinct from 'string' or length(field#>>'{}')>10000) then return false;
        elsif key='inputId' and (jsonb_typeof(field) is distinct from 'string' or length(field#>>'{}')>160) then return false;
        elsif key='order' and (jsonb_typeof(field) is distinct from 'number' or abs((field#>>'{}')::numeric)>1000000) then return false;
        elsif key='generation' and (jsonb_typeof(field) is distinct from 'number' or field::text !~ '^[0-9]+$' or (field#>>'{}')::numeric not between 1 and 1000000) then return false;
        elsif key='kind' and (jsonb_typeof(field) is distinct from 'string' or field#>>'{}' not in ('checkbox','boolean','number','time','duration','text','choice','tasks')) then return false;
        elsif key='visibility' and field#>>'{}' not in ('relevant','always') then return false;
        elsif key='deleted' and jsonb_typeof(field) is distinct from 'boolean' then return false;
        elsif key in ('min','max','step') and (jsonb_typeof(field) is distinct from 'number' or abs((field#>>'{}')::numeric)>1000000000 or (key='step' and (field#>>'{}')::numeric<=0)) then return false;
        elsif key='schedule' and not public.customization_valid_schedule(field) then return false;
        elsif key='completion' and public.customization_valid_rule(field) is not true then return false;
        elsif key='options' and not public.customization_valid_options(field) then return false;
        elsif key='followups' then
          if jsonb_typeof(field) is distinct from 'array' or jsonb_array_length(field)>50 then return false; end if;
          for followup in select * from jsonb_array_elements(field) loop
            if jsonb_typeof(followup) is distinct from 'object' or not public.customization_valid_id(followup->>'id')
              or followup-array['id','kind','label','condition','required','options','min','max','defaultValue','countField','placeholder','initiallyExpanded','displayChoiceLabel','resetOnAnswer','ariaLabel','preferenceKey','addLabel','viewLabel']<>'{}'::jsonb
              or jsonb_typeof(followup->'kind') is distinct from 'string' or followup->>'kind' not in ('note','counter','choice','occurrences')
              or jsonb_typeof(followup->'label') is distinct from 'string' or length(followup->>'label')>500
              or (followup ? 'condition' and public.customization_valid_rule(followup->'condition') is not true)
              or (followup ? 'options' and not public.customization_valid_options(followup->'options')) then return false; end if;
            if exists(select 1 from jsonb_each(followup) f where f.key in ('required','initiallyExpanded','displayChoiceLabel','resetOnAnswer') and jsonb_typeof(f.value)<>'boolean') then return false; end if;
            if exists(select 1 from jsonb_each(followup) f where f.key in ('min','max') and jsonb_typeof(f.value)<>'number') then return false; end if;
            if exists(select 1 from jsonb_each(followup) f where f.key in ('ariaLabel','preferenceKey','addLabel','viewLabel','placeholder') and (jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>1000)) then return false; end if;
            if followup ? 'countField' and not public.customization_valid_id(followup->>'countField') then return false; end if;
            if followup ? 'defaultValue' and jsonb_typeof(followup->'defaultValue') not in ('boolean','number','string','null','array') then return false; end if;
            if jsonb_typeof(followup->'defaultValue')='array' and exists(select 1 from jsonb_array_elements(followup->'defaultValue') a where jsonb_typeof(a)<>'string') then return false; end if;
          end loop;
          if (select count(*)<>count(distinct f->>'id') from jsonb_array_elements(field) f) then return false; end if;
        end if;
      end loop;
    end loop;
  end loop;
  return true;
exception when others then return false;
end; $$;

-- Replaced below with the baseline generated from the shared template. Presentation
-- fields live in the same immutable baseline so partial edits have one meaning.
create function public.customization_seed_config(day date default date '9999-12-31') returns jsonb language sql immutable security invoker set search_path='' as $$
  select case when day<date '2026-10-12' then $template${"blocks":[{"id":"general","title":"General","icon":"compass","order":0},{"id":"school","title":"School","icon":"graduation-cap","order":1},{"id":"career","title":"Career","icon":"briefcase","order":2},{"id":"food","title":"Diet","icon":"utensils","order":3},{"id":"body","title":"Body","icon":"activity","order":4}],"items":[{"id":"wake","blockId":"general","label":"Wake-up time","kind":"time","generation":1,"order":0,"completion":{"op":"compare","field":"value","operator":"lte","value":600},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"compare","field":"value","operator":"gt","value":600},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Wake-up time reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Wake-up time reason"}],"legacyKey":"wake","inputId":"wake"},{"id":"screenTime","blockId":"general","label":"Screen time","kind":"duration","generation":1,"order":1,"completion":{"op":"compare","field":"value","operator":"lte","value":210},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"compare","field":"value","operator":"gt","value":210},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Screen time reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Screen time reason"}],"legacyKey":"screenTime","min":0,"max":1440,"inputId":"screen"},{"id":"cannabis","blockId":"general","label":"Used cannabis?","kind":"boolean","generation":1,"order":2,"completion":{"op":"any","rules":[{"op":"equals","field":"value","value":false},{"op":"all","rules":[{"op":"equals","field":"value","value":true},{"op":"compare","field":"count","operator":"lte","value":2}]}]},"followups":[{"id":"count","kind":"counter","label":"How many times?","condition":{"op":"equals","field":"value","value":true},"min":1,"max":2147483647,"defaultValue":1},{"id":"occurrences","kind":"occurrences","label":"Use","condition":{"op":"equals","field":"value","value":true},"countField":"count","initiallyExpanded":true,"placeholder":"Any details you\u2019d like to record.","ariaLabel":"Cannabis use {n} description","preferenceKey":"cannabis-use-descriptions"}],"legacyKey":"cannabis"},{"id":"classAttendance","blockId":"school","label":"Attended class","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Attended class reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Attended class reason"}],"legacyKey":"classAttendance","schedule":{"weekdays":[1,2,3,4,5]}},{"id":"schoolTasks","blockId":"school","label":"Worked on school tasks","kind":"tasks","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Worked on school tasks reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Worked on school tasks? reason"}],"legacyKey":"schoolTasks","listId":"school","visibility":"relevant"},{"id":"applications","blockId":"career","label":"Applied to jobs or internships","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"count","kind":"counter","label":"How many applications?","condition":{"op":"equals","field":"value","value":true},"min":1,"max":2147483647,"defaultValue":1},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Applied to jobs or internships reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Applied to jobs or internships? reason"}],"legacyKey":"applications"},{"id":"careerTasks","blockId":"career","label":"Worked on career tasks","kind":"tasks","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Worked on career tasks reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Worked on career tasks? reason"}],"legacyKey":"careerTasks","listId":"career","visibility":"relevant"},{"id":"amBreakfast","blockId":"food","label":"Breakfast","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"choice","kind":"choice","label":"Choose one (required)","condition":{"op":"equals","field":"value","value":true},"required":true,"displayChoiceLabel":true,"resetOnAnswer":true,"options":[{"id":"shake","label":"AM shake"},{"id":"meal","label":"Calorie dense meal"}]},{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"all","rules":[{"op":"equals","field":"value","value":true},{"op":"equals","field":"choice","value":"meal"}]},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Calorie dense meal food description","preferenceKey":"am-breakfast-food-description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Breakfast reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"AM Shake/Calorie-Dense Breakfast reason"}],"legacyKey":"amBreakfast","schedule":{"startDate":"2026-10-12"}},{"id":"meal1","blockId":"food","label":"Meal 1","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Meal 1 food description","preferenceKey":"Meal 1 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Meal 1 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Meal 1 reason"}],"legacyKey":"meal1"},{"id":"meal2","blockId":"food","label":"Meal 2","kind":"boolean","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Meal 2 food description","preferenceKey":"Meal 2 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Meal 2 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Meal 2 reason"}],"legacyKey":"meal2"},{"id":"snack1","blockId":"food","label":"Snack 1","kind":"boolean","generation":1,"order":2,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack 1 food description","preferenceKey":"Snack 1 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack 1 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack 1 reason"}],"legacyKey":"snack1","schedule":{"endDate":"2026-10-11"}},{"id":"snack2","blockId":"food","label":"Snack 2","kind":"boolean","generation":1,"order":3,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack 2 food description","preferenceKey":"Snack 2 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack 2 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack 2 reason"}],"legacyKey":"snack2","schedule":{"endDate":"2026-10-11"}},{"id":"shake","blockId":"food","label":"Bulking shake","kind":"boolean","generation":1,"order":4,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Bulking shake reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Bulking shake reason"}],"legacyKey":"shake"},{"id":"snack","blockId":"food","label":"Snack","kind":"boolean","generation":1,"order":99,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack food description","preferenceKey":"Snack food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack reason"}],"legacyKey":"snack","schedule":{"startDate":"2026-10-12"},"helper":"Fruit, protein bar, boba, etc"},{"id":"amPosture","blockId":"body","label":"AM posture exercises","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"AM posture exercises reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"AM posture exercises reason"}],"legacyKey":"amPosture"},{"id":"pmPosture","blockId":"body","label":"PM posture exercises","kind":"boolean","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"PM posture exercises reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"PM posture exercises reason"}],"legacyKey":"pmPosture"},{"id":"lifted","blockId":"body","label":"Lifted","kind":"boolean","generation":1,"order":2,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Lifted reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Lifted reason"}],"legacyKey":"lifted"},{"id":"creatine","blockId":"body","label":"Creatine","kind":"boolean","generation":1,"order":3,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Creatine reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Creatine reason"}],"legacyKey":"creatine","schedule":{"startDate":"2026-10-13"}}],"lists":[{"id":"school","title":"School","icon":"graduation-cap","order":0},{"id":"career","title":"Career","icon":"briefcase","order":1},{"id":"life","title":"Life","icon":"heart","order":2}]}$template$::jsonb when day<date '2026-10-13' then $template${"blocks":[{"id":"general","title":"General","icon":"compass","order":0},{"id":"school","title":"School","icon":"graduation-cap","order":1},{"id":"career","title":"Career","icon":"briefcase","order":2},{"id":"food","title":"Diet","icon":"utensils","order":3},{"id":"body","title":"Body","icon":"activity","order":4}],"items":[{"id":"wake","blockId":"general","label":"Wake-up time","kind":"time","generation":1,"order":0,"completion":{"op":"compare","field":"value","operator":"lte","value":600},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"compare","field":"value","operator":"gt","value":600},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Wake-up time reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Wake-up time reason"}],"legacyKey":"wake","inputId":"wake"},{"id":"screenTime","blockId":"general","label":"Screen time","kind":"duration","generation":1,"order":1,"completion":{"op":"compare","field":"value","operator":"lte","value":210},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"compare","field":"value","operator":"gt","value":210},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Screen time reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Screen time reason"}],"legacyKey":"screenTime","min":0,"max":1440,"inputId":"screen"},{"id":"cannabis","blockId":"general","label":"Used cannabis?","kind":"boolean","generation":1,"order":2,"completion":{"op":"any","rules":[{"op":"equals","field":"value","value":false},{"op":"all","rules":[{"op":"equals","field":"value","value":true},{"op":"compare","field":"count","operator":"lte","value":2}]}]},"followups":[{"id":"count","kind":"counter","label":"How many times?","condition":{"op":"equals","field":"value","value":true},"min":1,"max":2147483647,"defaultValue":1},{"id":"occurrences","kind":"occurrences","label":"Use","condition":{"op":"equals","field":"value","value":true},"countField":"count","initiallyExpanded":true,"placeholder":"Any details you\u2019d like to record.","ariaLabel":"Cannabis use {n} description","preferenceKey":"cannabis-use-descriptions"}],"legacyKey":"cannabis"},{"id":"classAttendance","blockId":"school","label":"Attended class","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Attended class reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Attended class reason"}],"legacyKey":"classAttendance","schedule":{"weekdays":[1,2,3,4,5]}},{"id":"schoolTasks","blockId":"school","label":"Worked on school tasks","kind":"tasks","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Worked on school tasks reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Worked on school tasks? reason"}],"legacyKey":"schoolTasks","listId":"school","visibility":"relevant"},{"id":"applications","blockId":"career","label":"Applied to jobs or internships","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"count","kind":"counter","label":"How many applications?","condition":{"op":"equals","field":"value","value":true},"min":1,"max":2147483647,"defaultValue":1},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Applied to jobs or internships reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Applied to jobs or internships? reason"}],"legacyKey":"applications"},{"id":"careerTasks","blockId":"career","label":"Worked on career tasks","kind":"tasks","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Worked on career tasks reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Worked on career tasks? reason"}],"legacyKey":"careerTasks","listId":"career","visibility":"relevant"},{"id":"amBreakfast","blockId":"food","label":"Breakfast","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"choice","kind":"choice","label":"Choose one (required)","condition":{"op":"equals","field":"value","value":true},"required":true,"displayChoiceLabel":true,"resetOnAnswer":true,"options":[{"id":"shake","label":"AM shake"},{"id":"meal","label":"Calorie dense meal"}]},{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"all","rules":[{"op":"equals","field":"value","value":true},{"op":"equals","field":"choice","value":"meal"}]},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Calorie dense meal food description","preferenceKey":"am-breakfast-food-description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Breakfast reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"AM Shake/Calorie-Dense Breakfast reason"}],"legacyKey":"amBreakfast","schedule":{"startDate":"2026-10-12"}},{"id":"meal1","blockId":"food","label":"Lunch","kind":"boolean","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Lunch food description","preferenceKey":"Meal 1 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Lunch reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Meal 1 reason"}],"legacyKey":"meal1"},{"id":"meal2","blockId":"food","label":"Dinner","kind":"boolean","generation":1,"order":2,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Dinner food description","preferenceKey":"Meal 2 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Dinner reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Meal 2 reason"}],"legacyKey":"meal2"},{"id":"snack1","blockId":"food","label":"Snack 1","kind":"boolean","generation":1,"order":99,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack 1 food description","preferenceKey":"Snack 1 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack 1 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack 1 reason"}],"legacyKey":"snack1","schedule":{"endDate":"2026-10-11"}},{"id":"snack2","blockId":"food","label":"Snack 2","kind":"boolean","generation":1,"order":99,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack 2 food description","preferenceKey":"Snack 2 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack 2 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack 2 reason"}],"legacyKey":"snack2","schedule":{"endDate":"2026-10-11"}},{"id":"shake","blockId":"food","label":"PM Shake","kind":"boolean","generation":1,"order":3,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"PM Shake reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Bulking shake reason"}],"legacyKey":"shake"},{"id":"snack","blockId":"food","label":"Snack","kind":"boolean","generation":1,"order":4,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack food description","preferenceKey":"Snack food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack reason"}],"legacyKey":"snack","schedule":{"startDate":"2026-10-12"},"helper":"Fruit, protein bar, boba, etc"},{"id":"amPosture","blockId":"body","label":"AM posture exercises","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"AM posture exercises reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"AM posture exercises reason"}],"legacyKey":"amPosture"},{"id":"pmPosture","blockId":"body","label":"PM posture exercises","kind":"boolean","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"PM posture exercises reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"PM posture exercises reason"}],"legacyKey":"pmPosture"},{"id":"lifted","blockId":"body","label":"Lifted","kind":"boolean","generation":1,"order":2,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Lifted reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Lifted reason"}],"legacyKey":"lifted"},{"id":"creatine","blockId":"body","label":"Creatine","kind":"boolean","generation":1,"order":3,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Creatine reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Creatine reason"}],"legacyKey":"creatine","schedule":{"startDate":"2026-10-13"}}],"lists":[{"id":"school","title":"School","icon":"graduation-cap","order":0},{"id":"career","title":"Career","icon":"briefcase","order":1},{"id":"life","title":"Life","icon":"heart","order":2}]}$template$::jsonb else $template${"blocks":[{"id":"general","title":"General","icon":"compass","order":0},{"id":"school","title":"School","icon":"graduation-cap","order":1},{"id":"career","title":"Career","icon":"briefcase","order":2},{"id":"food","title":"Diet","icon":"utensils","order":3},{"id":"body","title":"Body","icon":"activity","order":4}],"items":[{"id":"wake","blockId":"general","label":"Wake-up time","kind":"time","generation":1,"order":0,"completion":{"op":"compare","field":"value","operator":"lte","value":600},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"compare","field":"value","operator":"gt","value":600},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Wake-up time reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Wake-up time reason"}],"legacyKey":"wake","inputId":"wake"},{"id":"screenTime","blockId":"general","label":"Screen time","kind":"duration","generation":1,"order":1,"completion":{"op":"compare","field":"value","operator":"lte","value":210},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"compare","field":"value","operator":"gt","value":210},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Screen time reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Screen time reason"}],"legacyKey":"screenTime","min":0,"max":1440,"inputId":"screen"},{"id":"cannabis","blockId":"general","label":"Used cannabis?","kind":"boolean","generation":1,"order":2,"completion":{"op":"any","rules":[{"op":"equals","field":"value","value":false},{"op":"all","rules":[{"op":"equals","field":"value","value":true},{"op":"compare","field":"count","operator":"lte","value":2}]}]},"followups":[{"id":"count","kind":"counter","label":"How many times?","condition":{"op":"equals","field":"value","value":true},"min":1,"max":2147483647,"defaultValue":1},{"id":"occurrences","kind":"occurrences","label":"Use","condition":{"op":"equals","field":"value","value":true},"countField":"count","initiallyExpanded":true,"placeholder":"Any details you\u2019d like to record.","ariaLabel":"Cannabis use {n} description","preferenceKey":"cannabis-use-descriptions"}],"legacyKey":"cannabis"},{"id":"classAttendance","blockId":"school","label":"Attended class","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Attended class reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Attended class reason"}],"legacyKey":"classAttendance","schedule":{"weekdays":[1,2,3,4,5]}},{"id":"schoolTasks","blockId":"school","label":"Worked on school tasks","kind":"tasks","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Worked on school tasks reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Worked on school tasks? reason"}],"legacyKey":"schoolTasks","listId":"school","visibility":"relevant"},{"id":"applications","blockId":"career","label":"Applied to jobs or internships","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"count","kind":"counter","label":"How many applications?","condition":{"op":"equals","field":"value","value":true},"min":1,"max":2147483647,"defaultValue":1},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Applied to jobs or internships reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Applied to jobs or internships? reason"}],"legacyKey":"applications"},{"id":"careerTasks","blockId":"career","label":"Worked on career tasks","kind":"tasks","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Worked on career tasks reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Worked on career tasks? reason"}],"legacyKey":"careerTasks","listId":"career","visibility":"relevant"},{"id":"amBreakfast","blockId":"food","label":"Breakfast","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"choice","kind":"choice","label":"Choose one (required)","condition":{"op":"equals","field":"value","value":true},"required":true,"displayChoiceLabel":true,"resetOnAnswer":true,"options":[{"id":"shake","label":"AM shake"},{"id":"meal","label":"Calorie dense meal"}]},{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"all","rules":[{"op":"equals","field":"value","value":true},{"op":"equals","field":"choice","value":"meal"}]},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Calorie dense meal food description","preferenceKey":"am-breakfast-food-description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Breakfast reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"AM Shake/Calorie-Dense Breakfast reason"}],"legacyKey":"amBreakfast","schedule":{"startDate":"2026-10-12"}},{"id":"meal1","blockId":"food","label":"Lunch","kind":"boolean","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Lunch food description","preferenceKey":"Meal 1 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Lunch reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Meal 1 reason"}],"legacyKey":"meal1"},{"id":"meal2","blockId":"food","label":"Dinner","kind":"boolean","generation":1,"order":2,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Dinner food description","preferenceKey":"Meal 2 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Dinner reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Meal 2 reason"}],"legacyKey":"meal2"},{"id":"snack1","blockId":"food","label":"Snack 1","kind":"boolean","generation":1,"order":99,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack 1 food description","preferenceKey":"Snack 1 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack 1 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack 1 reason"}],"legacyKey":"snack1","schedule":{"endDate":"2026-10-11"}},{"id":"snack2","blockId":"food","label":"Snack 2","kind":"boolean","generation":1,"order":99,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack 2 food description","preferenceKey":"Snack 2 food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack 2 reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack 2 reason"}],"legacyKey":"snack2","schedule":{"endDate":"2026-10-11"}},{"id":"shake","blockId":"food","label":"PM Shake","kind":"boolean","generation":1,"order":3,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"PM Shake reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Bulking shake reason"}],"legacyKey":"shake"},{"id":"snack","blockId":"food","label":"Snack","kind":"boolean","generation":1,"order":4,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"description","kind":"note","label":"What did you eat?","condition":{"op":"equals","field":"value","value":true},"placeholder":"Just a quick description","initiallyExpanded":true,"addLabel":"What did you eat? Add description","viewLabel":"View food description","ariaLabel":"Snack food description","preferenceKey":"Snack food description"},{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Snack reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Snack reason"}],"legacyKey":"snack","schedule":{"startDate":"2026-10-12"},"helper":"Fruit, protein bar, boba, etc"},{"id":"amPosture","blockId":"body","label":"AM posture exercises","kind":"boolean","generation":1,"order":0,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"AM posture exercises reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"AM posture exercises reason"}],"legacyKey":"amPosture"},{"id":"pmPosture","blockId":"body","label":"PM posture exercises","kind":"boolean","generation":1,"order":1,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"PM posture exercises reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"PM posture exercises reason"}],"legacyKey":"pmPosture"},{"id":"lifted","blockId":"body","label":"Lifted","kind":"boolean","generation":1,"order":2,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Lifted reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Lifted reason"}],"legacyKey":"lifted"},{"id":"creatine","blockId":"body","label":"Creatine","kind":"boolean","generation":1,"order":3,"completion":{"op":"equals","field":"value","value":true},"followups":[{"id":"reason","kind":"note","label":"Why?","condition":{"op":"equals","field":"value","value":false},"placeholder":"A little context, if you want.","initiallyExpanded":true,"ariaLabel":"Creatine reason","addLabel":"Why? Add reason","viewLabel":"View reason","preferenceKey":"Creatine reason"}],"legacyKey":"creatine","schedule":{"startDate":"2026-10-13"}}],"lists":[{"id":"school","title":"School","icon":"graduation-cap","order":0},{"id":"career","title":"Career","icon":"briefcase","order":1},{"id":"life","title":"Life","icon":"heart","order":2}]}$template$::jsonb end
$$;

create function public.customization_merge(config jsonb, patch jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare bucket text; entity jsonb; records jsonb; prior jsonb;
begin
  foreach bucket in array array['blocks','items','lists'] loop
    records:=coalesce(config->bucket,'[]'::jsonb);
    for entity in select * from jsonb_array_elements(coalesce(patch->bucket,'[]'::jsonb)) loop
      select x into prior from jsonb_array_elements(records) x where x->>'id'=entity->>'id';
      records:=coalesce((select jsonb_agg(x) from jsonb_array_elements(records) x where x->>'id'<>entity->>'id'),'[]'::jsonb)
        ||jsonb_build_array(coalesce(prior,'{}'::jsonb)||entity);
    end loop;
    config:=jsonb_set(config,array[bucket],records);
  end loop;
  return config;
end; $$;

create function public.customization_config_at(day date, max_revision bigint default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare config jsonb:=public.customization_seed_config(day); change public.config_changes;
begin
  for change in select * from public.config_changes where user_id=auth.uid() and effective_date<=day and (max_revision is null or sequence<=max_revision) order by sequence loop
    config:=public.customization_merge(config,change.patch);
  end loop;
  return config;
end; $$;

create function public.customization_validate_config(config jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare entity jsonb; baseline jsonb; previous text[]:='{}';
begin
  if not public.customization_valid_patch(config) then raise exception 'Invalid configuration'; end if;
  if jsonb_array_length(config->'blocks')>200 or jsonb_array_length(config->'lists')>200 or jsonb_array_length(config->'items')>2000 then raise exception 'Configuration limit exceeded'; end if;
  for entity in select * from jsonb_array_elements(config->'blocks') union all select * from jsonb_array_elements(config->'lists') loop
    if not(entity ?& array['id','title','icon','order']) then raise exception 'Incomplete block or list'; end if;
  end loop;
  for entity in select * from jsonb_array_elements(config->'items') loop
    if not(entity ?& array['id','blockId','label','kind','generation','order','completion','followups']) then raise exception 'Incomplete checklist item'; end if;
    select i into baseline from jsonb_array_elements((public.customization_seed_config()->'items')||(public.customization_seed_config(date '2026-10-09')->'items')) i where i->>'id'=entity->>'id' limit 1;
    if entity->>'generation'='1' and baseline is not null and entity->>'kind'<>baseline->>'kind' then raise exception 'An input type change needs a new answer generation'; end if;
    if nullif(entity->'legacyKey','null'::jsonb) is not null and (baseline is null or entity->>'legacyKey'<>entity->>'id' or entity->>'generation'<>'1') then raise exception 'Invalid legacy answer binding'; end if;
    if not exists(select 1 from jsonb_array_elements(config->'blocks') b where b->>'id'=entity->>'blockId') then raise exception 'Unknown checklist block'; end if;
    if entity->>'kind'='tasks' then
      if not exists(select 1 from jsonb_array_elements(config->'lists') l where l->>'id'=entity->>'listId') then raise exception 'Unknown linked list'; end if;
      if entity->'deleted' is distinct from 'true'::jsonb then
        if entity->>'listId'=any(previous) then raise exception 'A list can have only one linked question'; end if;
        previous:=array_append(previous,entity->>'listId');
      end if;
    end if;
    if entity ? 'min' and entity ? 'max' and (entity->>'min')::numeric>(entity->>'max')::numeric then raise exception 'Invalid item range'; end if;
  end loop;
end; $$;

create function public.guard_config_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actual bigint; highest_generation integer; day date; config jsonb; entity jsonb; prior jsonb; next_item jsonb; followup jsonb; previous_followup jsonb;
begin
  if tg_op<>'INSERT' then raise exception 'Configuration revisions are immutable'; end if;
  if auth.uid() is null or new.user_id<>auth.uid() or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
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
create trigger guard_config_change before insert or update or delete on public.config_changes for each row execute function public.guard_config_change();
create trigger validate_config_change after insert on public.config_changes for each row execute function public.guard_config_change();

create function public.apply_customization_operation(p_operation_id uuid,p_effective_date date,p_base_revision bigint,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare change public.config_changes; receipt public.operation_receipts; actual bigint;
begin
  if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
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

-- Find retained generations as well as the active one; old queued answers remain
-- attached to their original typed schema after a later type edit or archive.
create function public.customization_item_at(item text, answer_generation integer, day date, max_revision bigint default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare definition jsonb; rev bigint;
begin
  select x into definition from jsonb_array_elements(public.customization_config_at(day,max_revision)->'items') x where x->>'id'=item and (x->>'generation')::integer=answer_generation;
  if definition is not null then return definition; end if;
  for rev in select sequence from public.config_changes where user_id=auth.uid() and effective_date<=day and (max_revision is null or sequence<=max_revision) union select 0 order by 1 desc loop
    select x into definition from jsonb_array_elements(public.customization_config_at(day,rev)->'items') x where x->>'id'=item and (x->>'generation')::integer=answer_generation;
    if definition is not null then return definition; end if;
  end loop;
  return null;
end; $$;

create function public.customization_valid_answer(value jsonb, definition jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare field text; answer jsonb; followup jsonb; kind text:=definition->>'kind'; main jsonb:=value->'value';
begin
  if definition is null or jsonb_typeof(value) is distinct from 'object' or not(value ?& array['generation','value','fields','selections'])
    or value-array['generation','value','fields','selections']<>'{}'::jsonb or value->'generation'<>definition->'generation'
    or jsonb_typeof(value->'fields') is distinct from 'object' or length(value::text)>1000000 then return false; end if;
  if main<>'null'::jsonb then
    if kind in ('checkbox','boolean','tasks') and jsonb_typeof(main)<>'boolean' then return false;
    elsif kind in ('number','duration') and jsonb_typeof(main)<>'number' then return false;
    elsif kind in ('text','choice','time') and jsonb_typeof(main)<>'string' then return false;
    elsif kind='time' and main#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false;
    elsif kind='choice' and not exists(select 1 from jsonb_array_elements(coalesce(definition->'options','[]'::jsonb)) o where o->>'id'=main#>>'{}') then return false; end if;
    if kind in ('number','duration') then
      if (nullif(definition->'min','null'::jsonb) is not null and (main#>>'{}')::numeric<(definition->>'min')::numeric)
        or (nullif(definition->'max','null'::jsonb) is not null and (main#>>'{}')::numeric>(definition->>'max')::numeric)
        or (kind='duration' and ((main#>>'{}')::numeric<0 or main::text !~ '^[0-9]+$')) then return false; end if;
    end if;
  end if;
  for field,answer in select * from jsonb_each(value->'fields') loop
    select f into followup from jsonb_array_elements(definition->'followups') f where f->>'id'=field;
    if followup is null then
      if definition ? 'legacyKey' and field in ('reason','description') and jsonb_typeof(answer)='string' then continue; end if;
      return false;
    end if;
    if answer='null'::jsonb then continue; end if;
    if followup->>'kind'='note' and jsonb_typeof(answer)<>'string' then return false;
    elsif followup->>'kind'='counter' and (jsonb_typeof(answer)<>'number' or answer::text !~ '^[0-9]+$' or answer::text::numeric>coalesce((followup->>'max')::numeric,2147483647) or answer::text::numeric<coalesce((followup->>'min')::numeric,0)) then return false;
    elsif followup->>'kind'='choice' and (jsonb_typeof(answer)<>'string' or not exists(select 1 from jsonb_array_elements(coalesce(followup->'options','[]'::jsonb)) o where o->>'id'=answer#>>'{}')) then return false;
    elsif followup->>'kind'='occurrences' then
      if jsonb_typeof(answer)<>'array' or jsonb_array_length(answer)>10000 or exists(select 1 from jsonb_array_elements(answer) a where jsonb_typeof(a)<>'string') then return false; end if;
    end if;
  end loop;
  return public.valid_daily_data(jsonb_build_object('schoolTasksWorkedOn',value->'selections'));
exception when others then return false;
end; $$;

create function public.guard_custom_answer() returns trigger language plpgsql security invoker set search_path='' as $$
declare definition jsonb; retained_definition jsonb; retained_field jsonb; field text; rev bigint;
begin
  if auth.uid() is null or new.user_id<>auth.uid() or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
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
create trigger guard_custom_answer before insert or update on public.custom_answers for each row execute function public.guard_custom_answer();

create function public.customization_merge_answer(source jsonb,patch jsonb,answer_generation integer) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select source||patch||jsonb_build_object('generation',answer_generation,'fields',coalesce(source->'fields','{}'::jsonb)||coalesce(patch->'fields','{}'::jsonb))
$$;

create function public.apply_custom_answer_operation(p_operation_id uuid,p_logical_date date,p_item_id text,p_generation integer,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare answer public.custom_answers; receipt public.operation_receipts; entity text; source jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
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

-- Dynamic lists retain the existing immutable task/list relationship and FK.
alter table public.tasks drop constraint tasks_topic_check;
alter table public.tasks add constraint tasks_topic_check check(public.customization_valid_id(topic));
alter table public.task_events drop constraint task_events_topic_check;
alter table public.task_events add constraint task_events_topic_check check(public.customization_valid_id(topic));

create function public.customization_legacy_answer(item text, answer_generation integer, data jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare definition jsonb; fields jsonb:='{}'; followup jsonb; value jsonb; selections jsonb:='[]'; key text;
begin
  select x into definition from jsonb_array_elements((public.customization_seed_config()->'items')||(public.customization_seed_config(date '2026-10-09')->'items')) x where x->>'id'=item and x->>'legacyKey'=item limit 1;
  if answer_generation<>1 or definition is null then return jsonb_build_object('generation',answer_generation,'value',null,'fields','{}'::jsonb,'selections','[]'::jsonb); end if;
  if item='wake' then value:=data->'wakeTime';
  elsif item='screenTime' then value:=data->'screenTimeMinutes';
  elsif item='amBreakfast' then value:=data->'amBreakfast'->'status';
  else value:=data->(item||'Status'); end if;
  for followup in select * from jsonb_array_elements(definition->'followups') loop
    key:=followup->>'id';
    if key='choice' and item='amBreakfast' then fields:=fields||jsonb_build_object(key,coalesce(data->'amBreakfast'->'choice','null'::jsonb));
    elsif key='count' then fields:=fields||jsonb_build_object(key,coalesce(nullif(data->(item||'Count'),'null'::jsonb),'1'::jsonb));
    elsif key='occurrences' then fields:=fields||jsonb_build_object(key,coalesce(data->'cannabisUseDescriptions','[]'::jsonb));
    elsif key='description' then fields:=fields||jsonb_build_object(key,coalesce(data->(item||'Description'),'""'::jsonb));
    elsif key='reason' then fields:=fields||jsonb_build_object(key,coalesce(data->(item||'Reason'),'""'::jsonb));
    else fields:=fields||jsonb_build_object(key,coalesce(followup->'defaultValue','null'::jsonb)); end if;
  end loop;
  if item in ('schoolTasks','careerTasks') then selections:=coalesce(data->(item||'WorkedOn'),'[]'::jsonb); end if;
  return jsonb_build_object('generation',answer_generation,'value',coalesce(value,'null'::jsonb),'fields',fields,'selections',selections);
end; $$;

-- Only touched legacy fields are mirrored. This never writes a stale whole day.
create function public.customization_legacy_patch(item text, answer_generation integer, patch jsonb, current_data jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:='{}'; fields jsonb:=coalesce(patch->'fields','{}'::jsonb); definition jsonb;
begin
  select x into definition from jsonb_array_elements((public.customization_seed_config()->'items')||(public.customization_seed_config(date '2026-10-09')->'items')) x where x->>'id'=item and x->>'legacyKey'=item limit 1;
  if answer_generation<>1 or definition is null then return result; end if;
  if item='amBreakfast' then
    if patch ? 'value' or fields ? 'choice' then result:=jsonb_build_object('amBreakfast',coalesce(current_data->'amBreakfast','{"status":null,"choice":null}'::jsonb)
      ||case when patch ? 'value' then jsonb_build_object('status',patch->'value') else '{}'::jsonb end
      ||case when fields ? 'choice' then jsonb_build_object('choice',fields->'choice') else '{}'::jsonb end); end if;
  elsif patch ? 'value' then result:=jsonb_build_object(case item when 'wake' then 'wakeTime' when 'screenTime' then 'screenTimeMinutes' else item||'Status' end,patch->'value'); end if;
  if fields ? 'reason' and item<>'cannabis' then result:=result||jsonb_build_object(item||'Reason',fields->'reason'); end if;
  if fields ? 'description' and item in ('amBreakfast','meal1','meal2','snack1','snack2','snack') then result:=result||jsonb_build_object(item||'Description',fields->'description'); end if;
  if fields ? 'count' and item in ('cannabis','applications') then result:=result||jsonb_build_object(item||'Count',fields->'count'); end if;
  if fields ? 'occurrences' and item='cannabis' then result:=result||jsonb_build_object('cannabisUseDescriptions',fields->'occurrences'); end if;
  if patch ? 'selections' and item in ('schoolTasks','careerTasks') then result:=result||jsonb_build_object(item||'WorkedOn',patch->'selections'); end if;
  return result;
end; $$;

create function public.customization_bridge_answer(day date,item text,answer_generation integer,patch jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare entry public.daily_entries; legacy jsonb;
begin
  if answer_generation<>1 or not exists(select 1 from jsonb_array_elements((public.customization_seed_config()->'items')||(public.customization_seed_config(date '2026-10-09')->'items')) i where i->>'id'=item and i->>'legacyKey'=item) then return; end if;
  insert into public.daily_entries(user_id,logical_date) values(auth.uid(),day) on conflict do nothing;
  select * into entry from public.daily_entries where user_id=auth.uid() and logical_date=day for update;
  legacy:=public.customization_legacy_patch(item,answer_generation,patch,entry.data);
  if legacy<>'{}'::jsonb then update public.daily_entries set data=data||legacy,revision=revision+1,updated_at=clock_timestamp() where user_id=auth.uid() and logical_date=day; end if;
end; $$;

create function public.customization_refresh_legacy_answers(day date,patch jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare row public.custom_answers; data jsonb; projected jsonb; answer_patch jsonb; fields jsonb; key text; storage_key text;
begin
  select d.data into data from public.daily_entries d where d.user_id=auth.uid() and d.logical_date=day;
  for row in select * from public.custom_answers a where a.user_id=auth.uid() and a.logical_date=day and a.generation=1 for update loop
    key:=row.item_id; answer_patch:='{}'; fields:='{}';
    projected:=public.customization_legacy_answer(key,1,data);
    storage_key:=case key when 'wake' then 'wakeTime' when 'screenTime' then 'screenTimeMinutes' when 'amBreakfast' then 'amBreakfast' else key||'Status' end;
    if patch ? storage_key then
      answer_patch:=jsonb_build_object('value',projected->'value');
      if key='amBreakfast' then fields:=jsonb_build_object('choice',projected->'fields'->'choice'); end if;
    end if;
    if patch ? (key||'Reason') then fields:=fields||jsonb_build_object('reason',data->(key||'Reason')); end if;
    if patch ? (key||'Description') then fields:=fields||jsonb_build_object('description',data->(key||'Description')); end if;
    if key in ('cannabis','applications') and patch ? (key||'Count') then fields:=fields||jsonb_build_object('count',projected->'fields'->'count'); end if;
    if key='cannabis' and patch ? 'cannabisUseDescriptions' then fields:=fields||jsonb_build_object('occurrences',data->'cannabisUseDescriptions'); end if;
    if key in ('schoolTasks','careerTasks') and patch ? (key||'WorkedOn') then answer_patch:=answer_patch||jsonb_build_object('selections',data->(key||'WorkedOn')); end if;
    if fields<>'{}'::jsonb then answer_patch:=answer_patch||jsonb_build_object('fields',fields); end if;
    if answer_patch<>'{}'::jsonb then update public.custom_answers set value=public.customization_merge_answer(row.value,answer_patch,1) where user_id=row.user_id and logical_date=row.logical_date and item_id=row.item_id and generation=1; end if;
  end loop;
end; $$;

create or replace function public.apply_entry_patch(p_date date,p_operation uuid,p_patch jsonb,p_timezone text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry public.daily_entries; receipt public.operation_receipts;
begin
  perform public.check_entry_access(p_date,p_timezone);
  if p_operation is null or p_patch is null or not public.valid_daily_data(p_patch) then raise exception 'Invalid patch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('180:customization:'||auth.uid()::text,0));
  insert into public.daily_entries(user_id,logical_date) values(auth.uid(),p_date) on conflict do nothing;
  select * into entry from public.daily_entries where user_id=auth.uid() and logical_date=p_date for update;
  select * into receipt from public.operation_receipts where user_id=auth.uid() and operation_id=p_operation;
  if found then
    if receipt.entity_key <> 'day:'||p_date::text then raise exception 'Operation ID reused'; end if;
    return to_jsonb(entry);
  end if;
  update public.daily_entries set data=data||p_patch,revision=revision+1,updated_at=clock_timestamp()
    where user_id=auth.uid() and logical_date=p_date returning * into entry;
  perform public.customization_refresh_legacy_answers(p_date,p_patch);
  insert into public.operation_receipts(user_id,operation_id,entity_key) values(auth.uid(),p_operation,'day:'||p_date::text);
  return to_jsonb(entry);
end; $$;

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
  if auth.uid() is null or not exists(select 1 from public.app_owner where user_id=auth.uid()) then raise insufficient_privilege using message='Private account required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('180:customization:'||auth.uid()::text,0));
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
      if task_title is null or length(task_title) not between 1 and 500 or not public.customization_valid_id(task_topic) or (task_topic not in ('school','career','life') and not exists(select 1 from jsonb_array_elements(public.customization_config_at(d)->'lists') l where l->>'id'=task_topic)) then raise exception 'Invalid task title or topic'; end if;
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

-- Functions remain invoker-rights; ownership RLS and strict row guards also cover
-- direct table access. Never grant this private customization surface to anon.
revoke execute on function public.customization_valid_id(text),public.customization_valid_options(jsonb),public.customization_valid_schedule(jsonb),public.customization_scheduled(jsonb,date),public.customization_valid_rule(jsonb,integer),public.customization_valid_patch(jsonb),public.customization_seed_config(date),public.customization_merge(jsonb,jsonb),public.customization_config_at(date,bigint),public.customization_validate_config(jsonb),public.guard_config_change(),public.apply_customization_operation(uuid,date,bigint,jsonb),public.customization_item_at(text,integer,date,bigint),public.customization_valid_answer(jsonb,jsonb),public.guard_custom_answer(),public.customization_merge_answer(jsonb,jsonb,integer),public.apply_custom_answer_operation(uuid,date,text,integer,jsonb),public.customization_legacy_answer(text,integer,jsonb),public.customization_legacy_patch(text,integer,jsonb,jsonb),public.customization_bridge_answer(date,text,integer,jsonb),public.customization_refresh_legacy_answers(date,jsonb) from public,anon;
grant execute on function public.customization_valid_id(text),public.customization_valid_options(jsonb),public.customization_valid_schedule(jsonb),public.customization_scheduled(jsonb,date),public.customization_valid_rule(jsonb,integer),public.customization_valid_patch(jsonb),public.customization_seed_config(date),public.customization_merge(jsonb,jsonb),public.customization_config_at(date,bigint),public.customization_validate_config(jsonb),public.guard_config_change(),public.apply_customization_operation(uuid,date,bigint,jsonb),public.customization_item_at(text,integer,date,bigint),public.customization_valid_answer(jsonb,jsonb),public.guard_custom_answer(),public.customization_merge_answer(jsonb,jsonb,integer),public.apply_custom_answer_operation(uuid,date,text,integer,jsonb),public.customization_legacy_answer(text,integer,jsonb),public.customization_legacy_patch(text,integer,jsonb,jsonb),public.customization_bridge_answer(date,text,integer,jsonb),public.customization_refresh_legacy_answers(date,jsonb) to authenticated;
