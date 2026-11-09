-- The catalog: one row per perfume. Price, volume and stock live in stg_product_variants.
select
    {{ to_int('id') }} as product_id,
    {{ to_uuid('public_id') }} as product_public_id,
    {{ clean_text('title') }} as title,
    {{ clean_text('brand') }} as brand,
    lower({{ clean_text('gender') }}) as gender,
    lower({{ clean_text('fragrance_family') }}) as fragrance_family,
    {{ to_text_array('fragrance_families') }} as fragrance_families,
    coalesce({{ to_int('pack_size') }}, 1) as pack_size,
    {{ to_int('popular_rank') }} as popular_rank,
    coalesce({{ to_bool('active') }}, true) as is_active,
    {{ to_utc('created_at') }} as created_at
from {{ source('raw', 'products') }}
