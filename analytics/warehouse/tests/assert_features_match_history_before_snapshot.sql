-- A second, independent check of the point-in-time features: recompute them from fct_orders and
-- fct_sessions, keeping only rows before each snapshot, and compare. A feature that peeked at the
-- future (more orders, a later visit, a shorter recency) shows up as a mismatch.
with features as (
    select * from {{ ref('mart_customer_features') }}
),

orders_before as (
    select
        f.customer_key,
        f.snapshot_at,
        count(o.order_id) as orders_placed,
        max(o.created_at) as last_order_at
    from features as f
    left join {{ ref('fct_orders') }} as o
        on o.customer_key = f.customer_key and o.created_at < f.snapshot_at
    group by f.customer_key, f.snapshot_at
),

visits_before as (
    select f.customer_key, f.snapshot_at, max(s.started_at) as last_visit_at
    from features as f
    left join {{ ref('fct_sessions') }} as s
        on s.customer_key = f.customer_key and s.started_at < f.snapshot_at
    group by f.customer_key, f.snapshot_at
)

select
    f.customer_key,
    f.snapshot_at,
    f.orders_placed,
    o.orders_placed as expected_orders_placed,
    f.recency_days,
    f.days_since_last_visit
from features as f
inner join orders_before as o on o.customer_key = f.customer_key and o.snapshot_at = f.snapshot_at
inner join visits_before as v on v.customer_key = f.customer_key and v.snapshot_at = f.snapshot_at
where f.orders_placed <> o.orders_placed
    -- Recency counts revenue orders only, so it can't be shorter than the latest order of any kind.
    or f.recency_days < {{ days_between('o.last_order_at', 'f.snapshot_at') }}
    or f.days_since_last_visit
        is distinct from {{ days_between('v.last_visit_at', 'f.snapshot_at') }}
