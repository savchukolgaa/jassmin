-- Real customers' orders: test accounts' orders dropped (by the order's email or the user's), with
-- the customer key, the discount rule and payment attempts. No personal data from here on.
with orders as (
    select * from {{ ref('stg_orders') }}
),

users as (
    select user_id, is_test_account from {{ ref('stg_users') }}
),

payments as (
    select
        order_id,
        count(*) as payment_attempts,
        count(*) filter (where status = 'failed') as failed_payment_attempts
    from {{ ref('stg_payments') }}
    group by order_id
),

discounts as (
    select discount_id, discount_slug, discount_kind from {{ ref('stg_discounts') }}
)

select
    o.order_id,
    o.customer_key,
    o.user_id is not null as is_registered_customer,
    o.cart_id,
    o.discount_id,
    d.discount_slug,
    d.discount_kind,
    o.status,
    o.payment_status,
    o.payment_method,
    o.cancel_reason,
    o.free_shipping,
    o.subtotal,
    o.discount_amount,
    o.shipping_amount,
    o.gift_card_amount,
    o.total_amount,
    o.raw_total_amount,
    o.currency,
    o.created_at,
    o.paid_at,
    o.shipped_at,
    o.arrived_at,
    o.completed_at,
    o.cancelled_at,
    o.returned_at,
    o.refunded_at,
    o.status in ('paid', 'shipped', 'completed') as is_revenue,
    coalesce(p.payment_attempts, 0) as payment_attempts,
    coalesce(p.failed_payment_attempts, 0) as failed_payment_attempts,
    o.is_price_outlier,
    o.had_lowercase_currency,
    o.has_impossible_timeline,
    o.timeline_fixed_from_history
from orders as o
left join users as u on u.user_id = o.user_id
left join payments as p on p.order_id = o.order_id
left join discounts as d on d.discount_id = o.discount_id
where not o.is_test_account
    and not coalesce(u.is_test_account, false)
