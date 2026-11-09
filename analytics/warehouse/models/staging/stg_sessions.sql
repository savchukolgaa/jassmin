-- Visits (#18). A missing device_type is 'unknown'. A session is a bot (`is_bot`) when it has more
-- than `bot_max_product_views_10min` product views within any 10 minutes, or at least
-- `bot_min_product_views_for_gap` product views with a median gap under `bot_median_gap_seconds`.
-- Only product views count for the gap: a real visitor's impressions arrive in batches with one
-- timestamp. Bots stay here, flagged; every model downstream excludes them.
with source as (
    select * from {{ source('raw', 'sessions') }}
),

sessions as (
    select
        {{ to_uuid('session_id') }} as session_id,
        {{ to_int('user_id') }} as user_id,
        {{ clean_text('anonymous_id') }} as anonymous_id,
        {{ to_utc('started_at') }} as started_at,
        {{ to_utc('ended_at') }} as ended_at,
        {{ clean_text('landing_page') }} as landing_page,
        coalesce(lower({{ clean_text('traffic_source') }}), 'direct') as traffic_source,
        lower({{ clean_text('traffic_medium') }}) as traffic_medium,
        {{ clean_text('traffic_campaign') }} as traffic_campaign,
        coalesce(lower({{ clean_text('device_type') }}), 'unknown') as device_type
    from source
),

events as (
    select session_id, event_type, created_at from {{ ref('stg_user_events') }}
),

product_views as (
    select
        session_id,
        count(*) over (
            partition by session_id
            order by created_at
            range between interval '10 minutes' preceding and current row
        ) as views_in_10min,
        extract(epoch from created_at - lag(created_at) over (
            partition by session_id order by created_at
        )) as gap_seconds
    from events
    where event_type = 'product_view'
),

view_stats as (
    select
        session_id,
        count(*) as product_view_count,
        max(views_in_10min) as max_product_views_10min,
        percentile_cont(0.5) within group (order by gap_seconds) as median_view_gap_seconds
    from product_views
    group by session_id
),

event_counts as (
    select session_id, count(*) as event_count
    from events
    group by session_id
)

select
    s.*,
    coalesce(c.event_count, 0) as event_count,
    coalesce(v.product_view_count, 0) as product_view_count,
    coalesce(v.max_product_views_10min, 0) as max_product_views_10min,
    round(v.median_view_gap_seconds::numeric, 2) as median_view_gap_seconds,
    coalesce(
        v.max_product_views_10min > {{ var('bot_max_product_views_10min') }}
        or (
            v.product_view_count >= {{ var('bot_min_product_views_for_gap') }}
            and v.median_view_gap_seconds < {{ var('bot_median_gap_seconds') }}
        ),
        false
    ) as is_bot
from sessions as s
left join event_counts as c on c.session_id = s.session_id
left join view_stats as v on v.session_id = s.session_id
