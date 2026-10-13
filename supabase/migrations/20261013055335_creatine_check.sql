-- Accept additive Creatine answer/reason fields; saved records and ownership policies are unchanged.
CREATE OR REPLACE FUNCTION public.valid_daily_data_v1(value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; v jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  for k,v in select * from jsonb_each(value) loop
    if k = any(array['meal1Status','meal2Status','snack1Status','snack2Status','shakeStatus','snackStatus','amPostureStatus','pmPostureStatus','liftedStatus','creatineStatus','classAttendanceStatus','cannabisStatus','applicationsStatus']) then
      if jsonb_typeof(v) not in ('boolean','null') then return false; end if;
    elsif k = any(array['wakeReason','meal1Reason','meal2Reason','snack1Reason','snack2Reason','shakeReason','amPostureReason','pmPostureReason','liftedReason','creatineReason','classAttendanceReason','cannabisReason','applicationsReason','screenTimeReason','meal1Description','meal2Description','snack1Description','snack2Description','journalText','amBreakfastReason','amBreakfastDescription','snackReason','snackDescription']) then
      if jsonb_typeof(v) <> 'string' then return false; end if;
    elsif k='amBreakfast' then
      if jsonb_typeof(v)<>'object' then return false; end if;
      if not(v ?& array['status','choice']) or v-array['status','choice']<>'{}'::jsonb then return false; end if;
      if jsonb_typeof(v->'status') not in ('boolean','null') then return false; end if;
      if v->'choice'<>'null'::jsonb then
        if jsonb_typeof(v->'choice')<>'string' or v->>'choice' not in ('shake','meal') then return false; end if;
        if v->'status' is distinct from 'true'::jsonb then return false; end if;
      end if;
    elsif k='cannabisUseDescriptions' then
      if jsonb_typeof(v) <> 'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(v) as item where jsonb_typeof(item) <> 'string') then return false; end if;
    elsif k='wakeTime' then
      if v <> 'null'::jsonb and (jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
    elsif k=any(array['cannabisCount','applicationsCount','screenTimeMinutes']) then
      if v <> 'null'::jsonb then
        if jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[0-9]+$' then return false; end if;
        if (v#>>'{}')::numeric > 2147483647 then return false; end if;
        if k='screenTimeMinutes' and (v#>>'{}')::numeric>1440 then return false; end if;
        if k<>'screenTimeMinutes' and (v#>>'{}')::numeric<1 then return false; end if;
      end if;
    else return false;
    end if;
  end loop;
  return true;
end; $function$;
