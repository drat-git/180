-- Additive JSON fields; legacy entries and older clients remain valid.
create or replace function public.valid_daily_data(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb; selection jsonb; child jsonb; legacy jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  legacy:=value-array['schoolTasksEligible','careerTasksEligible','schoolTasksStatus','careerTasksStatus','schoolTasksReason','careerTasksReason','schoolTasksWorkedOn','careerTasksWorkedOn'];
  if not public.valid_daily_data_v1(legacy) then return false; end if;
  for k,v in select e.key,e.value from jsonb_each(value) e where e.key=any(array['schoolTasksEligible','careerTasksEligible','schoolTasksStatus','careerTasksStatus','schoolTasksReason','careerTasksReason','schoolTasksWorkedOn','careerTasksWorkedOn']) loop
    if k in ('schoolTasksEligible','careerTasksEligible','schoolTasksStatus','careerTasksStatus') then
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

-- Eligibility is monotonic: a stale offline empty-list snapshot cannot erase
-- a requirement already recorded by another device. No daily answers change.
create function public.preserve_task_eligibility() returns trigger
language plpgsql security invoker set search_path='' as $$
declare topic text; key text; previous jsonb := '{}'::jsonb;
begin
  if TG_OP = 'UPDATE' then previous := OLD.data; end if;
  foreach topic in array array['school','career'] loop
    key := topic || 'TasksEligible';
    if previous->key = 'true'::jsonb
       or NEW.data->(topic || 'TasksStatus') in ('true'::jsonb,'false'::jsonb)
       or length(trim(coalesce(NEW.data->>(topic || 'TasksReason'),''))) > 0
       or jsonb_array_length(coalesce(NEW.data->(topic || 'TasksWorkedOn'),'[]'::jsonb)) > 0 then
      NEW.data := jsonb_set(NEW.data,array[key],'true'::jsonb);
    end if;
  end loop;
  return NEW;
end; $$;
revoke execute on function public.preserve_task_eligibility() from public,anon;
grant execute on function public.preserve_task_eligibility() to authenticated;
create trigger preserve_task_eligibility before insert or update on public.daily_entries
for each row execute function public.preserve_task_eligibility();
