-- Bot sessions never reach the marts. Returns the bot sessions found in fct_sessions or fct_events.
with bots as (
    select session_id from {{ ref('stg_sessions') }} where is_bot
)

select 'fct_sessions' as model, s.session_id
from {{ ref('fct_sessions') }} as s
inner join bots as b on b.session_id = s.session_id
union all
select 'fct_events', e.session_id
from {{ ref('fct_events') }} as e
inner join bots as b on b.session_id = e.session_id
