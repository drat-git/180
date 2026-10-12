-- Covers owner lookups and the subscription ownership foreign key.
create index push_installations_owner on public.push_installations(user_id);
