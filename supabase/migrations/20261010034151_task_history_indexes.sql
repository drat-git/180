create index tasks_owner_parent_topic on public.tasks(user_id,parent_id,topic);
create index task_events_owner_task_topic on public.task_events(user_id,task_id,topic);
