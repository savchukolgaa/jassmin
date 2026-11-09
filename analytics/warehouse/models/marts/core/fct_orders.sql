-- One row per order of a real customer: amounts (cleaned), lifecycle timestamps, the customer's order
-- sequence and the anomaly flags, so BI can show what the cleaning changed.
with lines as (
    select
        order_id,
        count(*) as line_count,
        sum(quantity) as item_count,
        sum(net_line_revenue) as net_revenue,
        bool_or(is_orphan_product) as has_orphan_product
    from {{ ref('int_order_lines') }}
    group by order_id
)

select
    o.order_id,
    o.customer_key,
    {{ kyiv_date('o.created_at') }} as order_date,
    o.created_at,
    o.status,
    o.payment_status,
    o.payment_method,
    o.cancel_reason,
    o.is_revenue,
    co.order_seq,
    co.order_seq = 1 as is_first_order,
    co.days_since_prev_order,
    o.discount_id,
    o.discount_slug,
    o.discount_kind,
    coalesce(l.line_count, 0) as line_count,
    coalesce(l.item_count, 0) as item_count,
    o.subtotal,
    o.discount_amount,
    o.shipping_amount,
    o.gift_card_amount,
    o.total_amount,
    coalesce(l.net_revenue, 0) as net_revenue,
    o.currency,
    o.free_shipping,
    o.payment_attempts,
    o.failed_payment_attempts,
    o.paid_at,
    o.shipped_at,
    o.arrived_at,
    o.completed_at,
    o.cancelled_at,
    o.returned_at,
    o.refunded_at,
    round((extract(epoch from o.shipped_at - o.created_at) / 3600.0)::numeric, 2) as hours_to_ship,
    {{ days_between('o.shipped_at', 'o.arrived_at') }} as days_in_transit,
    o.is_price_outlier,
    o.raw_total_amount,
    o.had_lowercase_currency,
    o.has_impossible_timeline,
    o.timeline_fixed_from_history,
    coalesce(l.has_orphan_product, false) as has_orphan_product
from {{ ref('int_orders') }} as o
inner join {{ ref('int_customer_orders') }} as co on co.order_id = o.order_id
left join lines as l on l.order_id = o.order_id
