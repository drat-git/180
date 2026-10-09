-- No administrator endpoint or privileged key is exposed to the browser.
-- The first, email-confirmed owner signs up normally. All other account creation is rejected.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create function private.enforce_single_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if lower(new.email)<>'dratgit@gmail.com' or new.email is null or exists(select 1 from public.app_owner) then
    raise exception 'Account registration is closed' using errcode='42501';
  end if;
  return new;
end; $$;
create function private.assign_app_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if lower(new.email)<>'dratgit@gmail.com' then raise exception 'Private account required'; end if;
  insert into public.app_owner(singleton,user_id) values(true,new.id);
  return new;
end; $$;
revoke all on function private.enforce_single_account(),private.assign_app_owner() from public,anon,authenticated;
create trigger private_account_gate before insert on auth.users for each row execute function private.enforce_single_account();
create trigger private_owner_assignment after insert on auth.users for each row execute function private.assign_app_owner();
