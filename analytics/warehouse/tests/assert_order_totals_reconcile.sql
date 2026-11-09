-- Order totals reconcile: the lines add up to the subtotal, the allocated discounts to the order's
-- discount, and total = subtotal - discount + shipping - gift card. Returns the orders that don't.
with lines as (
    select
        order_id,
        sum(gross_line_revenue) as lines_gross,
        sum(discount_allocated) as lines_discount
    from {{ ref('fct_order_items') }}
    group by order_id
)

select
    o.order_id,
    o.subtotal,
    l.lines_gross,
    o.discount_amount,
    l.lines_discount,
    o.total_amount
from {{ ref('fct_orders') }} as o
left join lines as l on l.order_id = o.order_id
where o.subtotal <> coalesce(l.lines_gross, 0)
    or o.discount_amount <> coalesce(l.lines_discount, 0)
    or o.total_amount
        <> o.subtotal - o.discount_amount + o.shipping_amount - o.gift_card_amount
