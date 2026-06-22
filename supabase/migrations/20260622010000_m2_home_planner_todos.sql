-- M2: live student home/planner/todo guardrails.

create or replace function guard_student_todo_source_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() = new.student_id and new.source = 'teacher' then
      raise exception 'students_cannot_create_teacher_todos';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and auth.uid() = old.student_id
    and old.source = 'teacher'
    and old.locked = true then
    if new.ai_check_enabled is distinct from old.ai_check_enabled
      or new.locked is distinct from old.locked
      or new.source is distinct from old.source
      or new.connection_id is distinct from old.connection_id
      or new.created_by is distinct from old.created_by
      or new.student_id is distinct from old.student_id then
      raise exception 'locked_teacher_todo_fields';
    end if;
  end if;

  if new.source = 'teacher' then
    new.locked := true;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_student_todo_source_lock_trigger on todos;
create trigger guard_student_todo_source_lock_trigger
before insert or update on todos
for each row execute function guard_student_todo_source_lock();

create or replace function get_peer_study_ranking(p_days integer default 7)
returns table (
  peer_count integer,
  current_user_minutes integer,
  peer_average_minutes integer,
  rank_percentile integer
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, grade
    from profiles
    where id = auth.uid()
      and role = 'student'
  ),
  peers as (
    select p.id
    from profiles p
    join me on true
    where p.role = 'student'
      and coalesce(p.grade, '') = coalesce(me.grade, '')
  ),
  totals as (
    select
      peers.id,
      coalesce(sum(greatest(s.duration_sec, 0)), 0)::integer as seconds
    from peers
    left join study_sessions s
      on s.student_id = peers.id
     and s.started_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
    group by peers.id
  ),
  ranked as (
    select
      id,
      seconds,
      rank() over (order by seconds desc) as rank_position,
      count(*) over () as cohort_count
    from totals
  ),
  mine as (
    select *
    from ranked
    where id = auth.uid()
  )
  select
    greatest(mine.cohort_count - 1, 0)::integer as peer_count,
    floor(mine.seconds / 60.0)::integer as current_user_minutes,
    floor(coalesce((select avg(seconds) from totals where id <> auth.uid()), 0) / 60.0)::integer as peer_average_minutes,
    case
      when mine.cohort_count <= 1 then 100
      else round(((mine.cohort_count - mine.rank_position)::numeric / (mine.cohort_count - 1)::numeric) * 100)::integer
    end as rank_percentile
  from mine;
$$;

revoke all on function get_peer_study_ranking(integer) from public;
grant execute on function get_peer_study_ranking(integer) to authenticated;

create index if not exists todos_student_due_date_idx on todos (student_id, due_date);
create index if not exists timetable_blocks_student_day_start_idx on timetable_blocks (student_id, day_of_week, start_min);
