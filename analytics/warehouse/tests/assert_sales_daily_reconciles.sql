-- The daily sales mart (#183) adds up to the order facts: every revenue order is on exactly one day,
-- with its net revenue. Returns a row when the totals differ.
with daily as (
    select sum(orders) as orders, sum(net_revenue) as net_revenue
    from {{ ref('mart_sales_daily') }}
),

facts as (
    select count(*) as orders, coalesce(sum(net_revenue), 0) as net_revenue
    from {{ ref('fct_orders') }}
    where is_revenue
)

select d.*, f.orders as fact_orders, f.net_revenue as fact_net_revenue
from daily as d
cross join facts as f
where d.orders <> f.orders or d.net_revenue <> f.net_revenue
