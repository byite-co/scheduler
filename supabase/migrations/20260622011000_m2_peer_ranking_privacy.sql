-- M2 privacy hardening: do not expose peer ranking aggregates for small cohorts.

drop function if exists get_peer_study_ranking(integer);
drop function if exists get_peer_study_ranking(integer, integer);

create or replace function get_peer_study_ranking(
  p_days integer default 7,
  p_min_cohort integer default 5
)
returns table (
  peer_count integer,
  min_cohort integer,
  can_show_peer_ranking boolean,
  current_user_minutes integer,
  peer_average_minutes integer,
  rank_percentile integer
)
language sql
stable
security definer
set search_path = public
as $$
  with limits as (
    select
      greatest(1, least(coalesce(p_days, 7), 30)) as days,
      greatest(5, coalesce(p_min_cohort, 5)) as min_cohort
  ),
  me as (
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
     and s.started_at >= now() - make_interval(days => (select days from limits))
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
    limits.min_cohort::integer as min_cohort,
    (mine.cohort_count >= limits.min_cohort)::boolean as can_show_peer_ranking,
    floor(mine.seconds / 60.0)::integer as current_user_minutes,
    case
      when mine.cohort_count >= limits.min_cohort
      then floor(coalesce((select avg(seconds) from totals where id <> auth.uid()), 0) / 60.0)::integer
      else null::integer
    end as peer_average_minutes,
    case
      when mine.cohort_count < limits.min_cohort then null::integer
      when mine.cohort_count <= 1 then null::integer
      else round(((mine.cohort_count - mine.rank_position)::numeric / (mine.cohort_count - 1)::numeric) * 100)::integer
    end as rank_percentile
  from mine
  cross join limits;
$$;

revoke all on function get_peer_study_ranking(integer, integer) from public;
grant execute on function get_peer_study_ranking(integer, integer) to authenticated;
