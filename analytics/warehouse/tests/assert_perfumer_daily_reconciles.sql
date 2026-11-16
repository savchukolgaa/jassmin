-- mart_perfumer_daily adds up to int_perfumer_messages (#166): per day, messages + rate_limited is
-- every message, answers + errors are the messages, and no subset outgrows its whole. Returns the
-- days that don't.
select d.*
from {{ ref('mart_perfumer_daily') }} as d
left join (
    select message_date, count(*) as total
    from {{ ref('int_perfumer_messages') }}
    group by message_date
) as m on m.message_date = d.date_day
where d.messages + d.rate_limited <> coalesce(m.total, 0)
    or d.answers + d.errors <> d.messages
    or d.answers_with_picks > d.answers
    or d.answers_clicked > d.answers_with_picks
    or d.answers_ordered_7d > d.answers_with_picks
    or d.ratings_up + d.ratings_down > d.answers
