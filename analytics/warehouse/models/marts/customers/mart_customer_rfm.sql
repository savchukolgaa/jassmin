-- Each customer's RFM as of the end of the data, and a churn-risk segment from fixed rules (#183, no
-- ML model). Only customers with at least one revenue order. In order:
--   new       their first revenue order is at most `rfm_new_days` old;
--   one_time  a single revenue order, older than that;
--   active    the last order is no older than their usual gap (the median days between their
--             revenue orders) x `rfm_gap_multiplier`, and at least `rfm_min_active_days`;
--   at_risk   older than that, up to `rfm_lost_days`;
--   lost      older than `rfm_lost_days`.
with data_window as (
    select data_end_at, data_end_date from {{ ref('int_data_window') }}
),

orders as (
    select
        customer_key,
        created_at,
        net_revenue,
        {{ days_between(
            'lag(created_at) over (partition by customer_key order by created_at, order_id)',
            'created_at'
        ) }} as gap_days
    from {{ ref('fct_orders') }}
    where is_revenue
),

customers as (
    select
        customer_key,
        min(created_at) as first_order_at,
        max(created_at) as last_order_at,
        count(*) as frequency,
        sum(net_revenue)::numeric(12, 2) as monetary,
        percentile_cont(0.5) within group (order by gap_days) as median_gap_days
    from orders
    group by customer_key
),

measured as (
    select
        c.*,
        w.data_end_date as as_of_date,
        {{ days_between('c.first_order_at', 'w.data_end_at') }} as tenure_days,
        {{ days_between('c.last_order_at', 'w.data_end_at') }} as recency_days,
        greatest(
            {{ var('rfm_min_active_days') }},
            coalesce(c.median_gap_days, 0) * {{ var('rfm_gap_multiplier') }}
        )::numeric(10, 2) as active_threshold_days
    from customers as c
    cross join data_window as w
)

select
    m.customer_key,
    m.as_of_date,
    {{ kyiv_date('m.first_order_at') }} as first_order_date,
    {{ kyiv_date('m.last_order_at') }} as last_order_date,
    m.tenure_days,
    m.recency_days,
    m.frequency,
    m.monetary,
    round(m.monetary / m.frequency, 2) as avg_order_value,
    round(m.median_gap_days::numeric, 2) as median_gap_days,
    m.active_threshold_days,
    case
        when m.tenure_days <= {{ var('rfm_new_days') }} then 'new'
        when m.frequency = 1 then 'one_time'
        when m.recency_days <= m.active_threshold_days then 'active'
        when m.recency_days <= {{ var('rfm_lost_days') }} then 'at_risk'
        else 'lost'
    end as segment,
    c.city,
    c.acquisition_channel
from measured as m
inner join {{ ref('dim_customers') }} as c on c.customer_key = m.customer_key
