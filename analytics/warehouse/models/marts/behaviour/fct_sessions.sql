-- One row per real visit (no bots, no test accounts) with the funnel it reached: viewed a product,
-- added to cart, started checkout, purchased.
with funnel as (
    select
        session_id,
        bool_or(event_type = 'product_view') as viewed_product,
        bool_or(event_type = 'add_to_cart') as added_to_cart,
        bool_or(event_type = 'checkout_start') as started_checkout,
        bool_or(event_type = 'purchase') as purchased
    from {{ ref('int_events') }}
    group by session_id
)

select
    s.session_id,
    s.customer_key,
    s.customer_key is not null as is_logged_in,
    {{ kyiv_date('s.started_at') }} as session_date,
    s.started_at,
    s.ended_at,
    greatest(extract(epoch from s.ended_at - s.started_at), 0)::integer as duration_seconds,
    s.landing_page,
    s.traffic_source,
    s.traffic_medium,
    s.traffic_campaign,
    s.device_type,
    s.event_count,
    s.product_view_count,
    coalesce(f.viewed_product, false) as viewed_product,
    coalesce(f.added_to_cart, false) as added_to_cart,
    coalesce(f.started_checkout, false) as started_checkout,
    coalesce(f.purchased, false) as purchased
from {{ ref('int_sessions') }} as s
left join funnel as f on f.session_id = s.session_id
