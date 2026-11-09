-- One row per real event (de-duplicated, no bots, no test accounts) with the #129 properties as typed
-- columns, for funnel, list and recommendation analysis.
select
    event_id,
    session_id,
    customer_key,
    event_type,
    {{ kyiv_date('created_at') }} as event_date,
    created_at as event_at,
    product_key,
    variant_public_id,
    volume_ml,
    price,
    in_stock,
    list_id,
    list_position,
    search_id,
    dwell_ms,
    device_type,
    source,
    medium,
    campaign,
    had_naive_timestamp
from {{ ref('int_events') }}
