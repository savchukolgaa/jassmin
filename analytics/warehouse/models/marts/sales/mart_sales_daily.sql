-- One row per Kyiv day the data covers (#183): revenue orders, their net revenue (goods after
-- discounts, without delivery), average order and units, and how many were first orders. A day
-- without orders is a row of zeros, so week, month and previous-period comparisons need no gaps
-- filled. An order counts on the day it was placed, as long as it is still revenue (paid, shipped or
-- completed): a later cancellation or return takes it out of its day.
with data_window as (
    select data_start_date, data_end_date from {{ ref('int_data_window') }}
),

days as (
    select d.date_day, d.week_start, d.month_start
    from {{ ref('dim_date') }} as d
    cross join data_window as w
    where d.date_day between w.data_start_date and w.data_end_date
),

orders as (
    select
        order_date,
        count(*) as orders,
        count(*) filter (where is_first_order) as first_orders,
        sum(net_revenue) as net_revenue,
        sum(item_count) as items,
        sum(gift_card_amount) as gift_card_redeemed
    from {{ ref('fct_orders') }}
    where is_revenue
    group by order_date
)

select
    d.date_day,
    d.week_start,
    d.month_start,
    coalesce(o.orders, 0) as orders,
    coalesce(o.first_orders, 0) as first_orders,
    coalesce(o.orders, 0) - coalesce(o.first_orders, 0) as repeat_orders,
    coalesce(o.net_revenue, 0)::numeric(12, 2) as net_revenue,
    case when o.orders > 0 then round(o.net_revenue / o.orders, 2) end as avg_order_value,
    coalesce(o.items, 0) as items,
    coalesce(o.gift_card_redeemed, 0)::numeric(12, 2) as gift_card_redeemed
from days as d
left join orders as o on o.order_date = d.date_day
