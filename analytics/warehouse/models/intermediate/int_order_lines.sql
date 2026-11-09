-- Order lines of real customers' orders, with the discount allocated to each line (#128) and the net
-- line revenue (gross - discount_allocated).
select
    i.order_item_id,
    i.order_id,
    o.customer_key,
    {{ product_key('i.product_id') }} as product_key,
    i.variant_id,
    i.volume_ml,
    i.quantity,
    i.unit_price,
    i.gross_line_revenue,
    i.discount_allocated,
    i.gross_line_revenue - i.discount_allocated as net_line_revenue,
    o.created_at as order_created_at,
    o.is_revenue,
    i.is_orphan_product
from {{ ref('stg_order_items') }} as i
inner join {{ ref('int_orders') }} as o on o.order_id = i.order_id
