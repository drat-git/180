-- Retire the discarded daily applicability snapshot experiment.
-- Leave validation of legacy flags in place so older queued patches still sync.
-- Applicability is now derived in the client; saved answers/history are untouched.
drop trigger if exists preserve_task_eligibility on public.daily_entries;
drop function if exists public.preserve_task_eligibility();
