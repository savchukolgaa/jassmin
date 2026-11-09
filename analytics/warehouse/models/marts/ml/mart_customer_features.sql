{#- The churn model's training table (#132, for #133): one row per customer and monthly snapshot.

    Snapshots are the 1st of each month, 00:00 Kyiv. A customer appears from the first snapshot at
    which they have a revenue order (paid, shipped or completed as of the snapshot).

    Point in time: every feature reads only rows strictly before `snapshot_at`. Orders by
    `created_at`; their status as of the snapshot from order_status_history (so an order returned
    after the snapshot still counts as a sale); visits by `started_at`; signup by `created_at`.
    `max_input_at` is the latest timestamp any feature read, and a test asserts it is before
    `snapshot_at`.

    Label: `churned_next_90d` is true when the customer places no order (except one cancelled
    because its payment failed) in [snapshot_at, snapshot_at + churn_horizon_days), and null when
    the data ends before that window does. -#}
{% set tz = var('timezone') %}
{% set horizon = var('churn_horizon_days') %}
{% set revenue_statuses = "('paid', 'shipped', 'completed')" %}

with data_window as (
    select * from {{ ref('int_data_window') }}
),

snapshots as (
    select
        local_ts at time zone '{{ tz }}' as snapshot_at,
        local_ts::date as snapshot_date
    from data_window
    cross join lateral generate_series(
        date_trunc('month', data_start_at at time zone '{{ tz }}') + interval '1 month',
        data_end_at at time zone '{{ tz }}',
        interval '1 month'
    ) as local_ts
),

orders as (
    select order_id, customer_key, created_at, status, cancel_reason
    from {{ ref('int_orders') }}
),

order_values as (
    select
        order_id,
        sum(gross_line_revenue) as gross,
        sum(discount_allocated) as discount,
        sum(net_line_revenue) as net
    from {{ ref('int_order_lines') }}
    group by order_id
),

orders_as_of as (
    select
        s.snapshot_at,
        s.snapshot_date,
        o.customer_key,
        o.order_id,
        o.created_at,
        coalesce(h.status, 'pending') as status_as_of,
        h.valid_from as status_changed_at,
        coalesce(v.gross, 0) as gross,
        coalesce(v.discount, 0) as discount,
        coalesce(v.net, 0) as net
    from snapshots as s
    inner join orders as o on o.created_at < s.snapshot_at
    left join {{ ref('int_order_status_intervals') }} as h
        on h.order_id = o.order_id
        and h.valid_from < s.snapshot_at
        and (h.valid_to is null or h.valid_to >= s.snapshot_at)
    left join order_values as v on v.order_id = o.order_id
),

order_features as (
    select
        snapshot_at,
        snapshot_date,
        customer_key,
        count(*) as orders_placed,
        count(*) filter (where status_as_of in {{ revenue_statuses }}) as frequency,
        coalesce(sum(net) filter (where status_as_of in {{ revenue_statuses }}), 0) as monetary,
        coalesce(sum(gross) filter (where status_as_of in {{ revenue_statuses }}), 0) as gross,
        coalesce(sum(discount) filter (where status_as_of in {{ revenue_statuses }}), 0)
            as discount,
        max(created_at) filter (where status_as_of in {{ revenue_statuses }})
            as last_revenue_order_at,
        min(created_at) as first_order_at,
        count(*) filter (
            where status_as_of in ('shipped', 'completed', 'returned', 'unclaimed')
        ) as shipped_orders,
        count(*) filter (where status_as_of = 'returned') as returned_orders,
        count(*) filter (where status_as_of = 'unclaimed') as unclaimed_orders,
        greatest(max(created_at), max(status_changed_at)) as max_order_input_at
    from orders_as_of
    group by snapshot_at, snapshot_date, customer_key
),

eligible as (
    select * from order_features where frequency > 0
),

signups as (
    select {{ customer_key('user_id') }} as customer_key, created_at as signup_at
    from {{ ref('stg_users') }}
    where not is_test_account
),

visits as (
    select
        e.snapshot_at,
        e.customer_key,
        count(*) filter (where s.started_at >= e.snapshot_at - interval '30 days') as sessions_30d,
        count(*) filter (where s.started_at >= e.snapshot_at - interval '90 days') as sessions_90d,
        max(s.started_at) as last_visit_at
    from eligible as e
    inner join {{ ref('int_sessions') }} as s
        on s.customer_key = e.customer_key
        and s.started_at < e.snapshot_at
    group by e.snapshot_at, e.customer_key
),

future_orders as (
    select
        e.snapshot_at,
        e.customer_key,
        count(o.order_id) as orders_in_horizon
    from eligible as e
    left join orders as o
        on o.customer_key = e.customer_key
        and o.created_at >= e.snapshot_at
        and o.created_at < e.snapshot_at + interval '{{ horizon }} days'
        and not (o.status = 'cancelled' and coalesce(o.cancel_reason, '') = 'payment_failed')
    group by e.snapshot_at, e.customer_key
),

features as (
    select
        e.customer_key,
        e.snapshot_date,
        e.snapshot_at,
        su.signup_at is not null as is_registered,
        case when su.signup_at < e.snapshot_at then su.signup_at end as signup_at_used,
        e.first_order_at,
        e.last_revenue_order_at,
        e.orders_placed,
        e.frequency,
        e.monetary,
        e.gross,
        e.discount,
        e.shipped_orders,
        e.returned_orders,
        e.unclaimed_orders,
        e.max_order_input_at,
        coalesce(v.sessions_30d, 0) as sessions_30d,
        coalesce(v.sessions_90d, 0) as sessions_90d,
        v.last_visit_at,
        f.orders_in_horizon
    from eligible as e
    left join signups as su on su.customer_key = e.customer_key
    left join visits as v on v.snapshot_at = e.snapshot_at and v.customer_key = e.customer_key
    left join future_orders as f
        on f.snapshot_at = e.snapshot_at and f.customer_key = e.customer_key
)

select
    f.customer_key,
    f.snapshot_date,
    f.snapshot_at,
    f.is_registered,
    {{ days_between('coalesce(f.signup_at_used, f.first_order_at)', 'f.snapshot_at') }} as tenure_days,
    {{ days_between('f.last_revenue_order_at', 'f.snapshot_at') }} as recency_days,
    f.frequency,
    f.monetary,
    round(f.monetary / f.frequency, 2) as avg_order_value,
    case when f.gross > 0 then round(f.discount / f.gross, 4) else 0 end as discount_share,
    f.orders_placed,
    case
        when f.shipped_orders > 0 then round(f.returned_orders::numeric / f.shipped_orders, 4)
        else 0
    end as return_rate,
    case
        when f.shipped_orders > 0 then round(f.unclaimed_orders::numeric / f.shipped_orders, 4)
        else 0
    end as unclaimed_rate,
    f.sessions_30d,
    f.sessions_90d,
    {{ days_between('f.last_visit_at', 'f.snapshot_at') }} as days_since_last_visit,
    greatest(f.max_order_input_at, f.last_visit_at, f.signup_at_used) as max_input_at,
    f.snapshot_at + interval '{{ horizon }} days' <= w.data_end_at as is_label_available,
    case
        when f.snapshot_at + interval '{{ horizon }} days' <= w.data_end_at
            then f.orders_in_horizon = 0
    end as churned_next_90d
from features as f
cross join data_window as w
