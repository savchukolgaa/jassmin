-- One row per order line of a real customer, with the discount allocated to the line and its net
-- revenue. Lines of deleted products point to the unknown product (-1).
select
    order_item_id,
    order_id,
    customer_key,
    product_key,
    variant_id,
    volume_ml,
    {{ kyiv_date('order_created_at') }} as order_date,
    quantity,
    unit_price,
    gross_line_revenue,
    discount_allocated,
    net_line_revenue,
    is_revenue,
    is_orphan_product
from {{ ref('int_order_lines') }}
