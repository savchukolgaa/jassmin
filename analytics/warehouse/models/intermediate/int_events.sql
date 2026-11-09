-- Real events: only those of real visits (no bots, no test accounts), de-duplicated in staging, with
-- the #129 event properties unpacked into typed columns.
select
    e.event_id,
    e.session_id,
    s.customer_key,
    e.event_type,
    e.created_at,
    case when e.product_id is not null then {{ product_key('p.product_id') }} end as product_key,
    e.device_type,
    e.source,
    e.medium,
    e.campaign,
    (e.event_properties ->> 'variant_id')::uuid as variant_public_id,
    (e.event_properties ->> 'volume_ml')::integer as volume_ml,
    (e.event_properties ->> 'price')::numeric(12, 2) as price,
    (e.event_properties ->> 'in_stock')::boolean as in_stock,
    e.event_properties ->> 'list_id' as list_id,
    (e.event_properties ->> 'list_position')::integer as list_position,
    (e.event_properties ->> 'search_id')::uuid as search_id,
    (e.event_properties ->> 'dwell_ms')::integer as dwell_ms,
    e.had_naive_timestamp
from {{ ref('stg_user_events') }} as e
inner join {{ ref('int_sessions') }} as s on s.session_id = e.session_id
left join {{ ref('stg_products') }} as p on p.product_id = e.product_id
