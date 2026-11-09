-- One row per customer: every registered (non-test) user, and every guest who ordered (one per
-- normalised email). Only the surrogate key and the city identify them: no name, email or phone.
with users as (
    select
        {{ customer_key('user_id') }} as customer_key,
        created_at as signup_at,
        acquisition_channel,
        first_touch_source,
        first_touch_medium,
        city,
        marketing_opt_in,
        locale,
        has_phone
    from {{ ref('stg_users') }}
    where not is_test_account
),

orders as (
    select * from {{ ref('int_orders') }}
),

customers as (
    select customer_key, bool_or(is_registered_customer) as is_registered
    from (
        select customer_key, is_registered_customer from orders
        union all
        select customer_key, true from users
    ) as all_customers
    group by customer_key
),

order_stats as (
    select
        customer_key,
        min(created_at) as first_order_at,
        max(created_at) as last_order_at,
        count(*) as order_count,
        count(*) filter (where is_revenue) as revenue_order_count
    from orders
    group by customer_key
),

revenue as (
    select customer_key, sum(net_line_revenue) as lifetime_net_revenue
    from {{ ref('int_order_lines') }}
    where is_revenue
    group by customer_key
),

first_orders as (
    select distinct on (customer_key) customer_key, cart_id
    from orders
    order by customer_key, created_at, order_id
),

first_order_source as (
    select f.customer_key, s.traffic_source as first_order_traffic_source
    from first_orders as f
    left join {{ ref('stg_carts') }} as c on c.cart_id = f.cart_id
    left join {{ ref('int_sessions') }} as s on s.session_id = c.session_id
),

devices as (
    select
        customer_key,
        count(*) as session_count,
        round(avg((device_type = 'mobile')::integer), 3) as share_mobile,
        round(avg((device_type = 'tablet')::integer), 3) as share_tablet,
        round(avg((device_type = 'desktop')::integer), 3) as share_desktop,
        round(avg((device_type = 'unknown')::integer), 3) as share_unknown_device,
        mode() within group (order by device_type) as primary_device
    from {{ ref('int_sessions') }}
    where customer_key is not null
    group by customer_key
),

family_views as (
    select e.customer_key, p.fragrance_family, count(*) as views
    from {{ ref('int_events') }} as e
    inner join {{ ref('stg_products') }} as p on p.product_id = e.product_key
    where e.event_type = 'product_view'
        and e.customer_key is not null
        and p.fragrance_family is not null
    group by e.customer_key, p.fragrance_family
),

family_purchases as (
    select l.customer_key, p.fragrance_family, sum(l.quantity) as units
    from {{ ref('int_order_lines') }} as l
    inner join {{ ref('stg_products') }} as p on p.product_id = l.product_key
    where p.fragrance_family is not null
    group by l.customer_key, p.fragrance_family
),

favourite_family as (
    select distinct on (customer_key) customer_key, fragrance_family as favourite_family
    from (
        select
            coalesce(v.customer_key, b.customer_key) as customer_key,
            coalesce(v.fragrance_family, b.fragrance_family) as fragrance_family,
            coalesce(v.views, 0) as views,
            coalesce(b.units, 0) as units
        from family_views as v
        full outer join family_purchases as b
            on b.customer_key = v.customer_key and b.fragrance_family = v.fragrance_family
    ) as families
    order by customer_key, views desc, units desc, fragrance_family
)

select
    c.customer_key,
    c.is_registered,
    u.signup_at,
    {{ kyiv_date('u.signup_at') }} as signup_date,
    coalesce(u.acquisition_channel, 'guest') as acquisition_channel,
    u.first_touch_source,
    u.first_touch_medium,
    u.city,
    coalesce(u.marketing_opt_in, false) as marketing_opt_in,
    u.locale,
    u.has_phone,
    o.first_order_at,
    {{ kyiv_date('o.first_order_at') }} as first_order_date,
    fs.first_order_traffic_source,
    o.last_order_at,
    coalesce(o.order_count, 0) as order_count,
    coalesce(o.revenue_order_count, 0) as revenue_order_count,
    coalesce(r.lifetime_net_revenue, 0) as lifetime_net_revenue,
    coalesce(d.session_count, 0) as session_count,
    d.share_mobile,
    d.share_tablet,
    d.share_desktop,
    d.share_unknown_device,
    d.primary_device,
    f.favourite_family
from customers as c
left join users as u on u.customer_key = c.customer_key
left join order_stats as o on o.customer_key = c.customer_key
left join revenue as r on r.customer_key = c.customer_key
left join first_order_source as fs on fs.customer_key = c.customer_key
left join devices as d on d.customer_key = c.customer_key
left join favourite_family as f on f.customer_key = c.customer_key
