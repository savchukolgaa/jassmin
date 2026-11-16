-- The AI perfumer per Kyiv day (#166): usage, answer time, errors, how often answers recommend
-- perfumes, click-through, 7-day conversion and ratings. Rate-limited messages never reached the
-- model, so they're counted apart and left out of every other figure. A rate is null when its
-- denominator is 0. The 7-day conversion of the last week of data is still incomplete.
with messages as (
    select * from {{ ref('int_perfumer_messages') }}
),

reached as (
    select * from messages where error is distinct from 'rate_limited'
)

select
    d.date_day,
    count(r.event_id) as messages,
    count(distinct r.session_id) as conversations,
    (
        select count(*) from messages as m
        where m.message_date = d.date_day and m.error = 'rate_limited'
    ) as rate_limited,
    count(*) filter (where not r.is_answered) as errors,
    round(
        count(*) filter (where not r.is_answered)::numeric / nullif(count(r.event_id), 0), 4
    ) as error_rate,
    percentile_cont(0.5) within group (order by r.latency_ms)
        filter (where r.is_answered) as latency_p50_ms,
    percentile_cont(0.95) within group (order by r.latency_ms)
        filter (where r.is_answered) as latency_p95_ms,
    count(*) filter (where r.is_answered) as answers,
    count(*) filter (where r.pick_count > 0) as answers_with_picks,
    round(
        count(*) filter (where r.pick_count > 0)::numeric
        / nullif(count(*) filter (where r.is_answered), 0),
        4
    ) as picks_share,
    count(*) filter (where r.asked_question) as questions,
    count(*) filter (where r.clicked_pick) as answers_clicked,
    round(
        count(*) filter (where r.clicked_pick)::numeric
        / nullif(count(*) filter (where r.pick_count > 0), 0),
        4
    ) as click_through_rate,
    count(*) filter (where r.ordered_pick_7d) as answers_ordered_7d,
    round(
        count(*) filter (where r.ordered_pick_7d)::numeric
        / nullif(count(*) filter (where r.pick_count > 0), 0),
        4
    ) as conversion_rate_7d,
    count(*) filter (where r.ordered_clicked_7d) as answers_ordered_clicked_7d,
    count(*) filter (where r.latest_rating = 'up') as ratings_up,
    count(*) filter (where r.latest_rating = 'down') as ratings_down,
    round(
        count(*) filter (where r.latest_rating = 'up')::numeric
        / nullif(count(*) filter (where r.latest_rating is not null), 0),
        4
    ) as up_share
from (select distinct message_date as date_day from messages) as d
left join reached as r on r.message_date = d.date_day
group by d.date_day
