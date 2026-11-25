-- Tester to bottle (#183): one row per customer whose first "trio" is a revenue order, with whether
-- they ordered a full bottle (a single 30, 50 or 100 ml size) within `tester_conversion_days` after
-- it. A trio is an order with the tester-trio rule (#98: any three single 10 ml sizes) or a line of a
-- tester set (a product with `pack_size` > 1). `is_window_complete` is false while the data doesn't
-- yet cover the whole window, so recent trios aren't counted as failures.
with orders as (
    select order_id, customer_key, created_at, order_date, discount_slug
    from {{ ref('fct_orders') }}
    where is_revenue
),

lines as (
    select l.order_id, l.volume_ml, p.pack_size
    from {{ ref('fct_order_items') }} as l
    inner join {{ ref('dim_products') }} as p on p.product_key = l.product_key
    where l.is_revenue
),

trios as (
    select distinct on (o.customer_key)
        o.customer_key,
        o.order_id as trio_order_id,
        o.created_at as trio_at,
        o.order_date as trio_date
    from orders as o
    where o.discount_slug = 'tester-trio'
        or exists (select 1 from lines as l where l.order_id = o.order_id and l.pack_size > 1)
    order by o.customer_key, o.created_at, o.order_id
),

bottles as (
    select distinct on (t.customer_key)
        t.customer_key,
        o.order_id as bottle_order_id,
        o.created_at as bottle_at
    from trios as t
    inner join orders as o
        on o.customer_key = t.customer_key
        and o.created_at > t.trio_at
        and o.created_at <= t.trio_at + make_interval(days => {{ var('tester_conversion_days') }})
    where exists (
        select 1 from lines as l
        where l.order_id = o.order_id and l.volume_ml in (30, 50, 100) and l.pack_size = 1
    )
    order by t.customer_key, o.created_at, o.order_id
)

select
    t.customer_key,
    t.trio_order_id,
    t.trio_date,
    date_trunc('month', t.trio_date)::date as trio_month,
    b.bottle_order_id,
    {{ kyiv_date('b.bottle_at') }} as bottle_date,
    {{ days_between('t.trio_at', 'b.bottle_at') }} as days_to_bottle,
    b.bottle_order_id is not null as converted,
    t.trio_at + make_interval(days => {{ var('tester_conversion_days') }}) <= w.data_end_at
        as is_window_complete
from trios as t
left join bottles as b on b.customer_key = t.customer_key
cross join {{ ref('int_data_window') }} as w
