-- The sizes of each perfume, with their price and (for tracked sizes) stock.
select
    {{ to_int('id') }} as variant_id,
    {{ to_uuid('public_id') }} as variant_public_id,
    {{ to_int('product_id') }} as product_id,
    {{ to_int('volume_ml') }} as volume_ml,
    {{ to_money('price') }} as price,
    coalesce({{ to_int('stock_quantity') }}, 0) as stock_quantity,
    coalesce({{ to_bool('track_stock') }}, false) as track_stock,
    {{ to_utc('created_at') }} as created_at
from {{ source('raw', 'product_variants') }}
