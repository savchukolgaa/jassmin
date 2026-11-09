-- Real visits: bot sessions and test accounts' sessions dropped. A logged-in visit carries the
-- customer key; an anonymous one has none.
select
    s.session_id,
    case when u.user_id is not null then {{ customer_key('s.user_id') }} end as customer_key,
    s.started_at,
    s.ended_at,
    s.landing_page,
    s.traffic_source,
    s.traffic_medium,
    s.traffic_campaign,
    s.device_type,
    s.event_count,
    s.product_view_count
from {{ ref('stg_sessions') }} as s
left join {{ ref('stg_users') }} as u on u.user_id = s.user_id
where not s.is_bot
    and not coalesce(u.is_test_account, false)
