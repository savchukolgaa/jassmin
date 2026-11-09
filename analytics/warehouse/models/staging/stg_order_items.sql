-- The lines of each order. #131's "deleted product" anomaly leaves a line with `product_id` null (or
-- an id that isn't in the catalog). Such a line is flagged `is_orphan_product`; when its size still
-- exists, the product is recovered from the size (`product_recovered_from_variant`). A line with
-- neither keeps `product_id` null, and the marts map it to the "unknown product" member (-1).
with items as (
    select
        {{ to_int('id') }} as order_item_id,
        {{ to_int('order_id') }} as order_id,
        {{ to_int('product_id') }} as raw_product_id,
        {{ to_int('variant_id') }} as raw_variant_id,
        {{ to_int('volume_ml') }} as volume_ml,
        {{ to_int('quantity') }} as quantity,
        {{ to_money('price_at_purchase') }} as unit_price,
        coalesce({{ to_money('discount_allocated') }}, 0) as discount_allocated
    from {{ source('raw', 'order_items') }}
)

select
    i.order_item_id,
    i.order_id,
    coalesce(p.product_id, v.product_id) as product_id,
    v.variant_id,
    coalesce(i.volume_ml, v.volume_ml) as volume_ml,
    i.quantity,
    i.unit_price,
    i.discount_allocated,
    i.quantity * i.unit_price as gross_line_revenue,
    p.product_id is null as is_orphan_product,
    p.product_id is null and v.product_id is not null as product_recovered_from_variant
from items as i
left join {{ ref('stg_products') }} as p on p.product_id = i.raw_product_id
left join {{ ref('stg_product_variants') }} as v
    on v.variant_id = i.raw_variant_id
    -- A size of another product than the line's own isn't evidence of anything.
    and (p.product_id is null or v.product_id = p.product_id)
