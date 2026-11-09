-- The lines of each cart, one per size.
select
    {{ to_int('id') }} as cart_item_id,
    {{ to_int('cart_id') }} as cart_id,
    {{ to_int('product_id') }} as product_id,
    {{ to_int('variant_id') }} as variant_id,
    {{ to_int('quantity') }} as quantity,
    {{ to_utc('added_at') }} as added_at
from {{ source('raw', 'cart_items') }}
