-- One row per perfume, with its size prices, plus the "unknown product" member (-1) that order lines
-- and events of deleted products point to.
with products as (
    select * from {{ ref('stg_products') }}
),

variants as (
    select
        product_id,
        max(price) filter (where volume_ml = 5) as price_5ml,
        max(price) filter (where volume_ml = 10) as price_10ml,
        max(price) filter (where volume_ml = 30) as price_30ml,
        max(price) filter (where volume_ml = 50) as price_50ml,
        max(price) filter (where volume_ml = 100) as price_100ml,
        bool_or(track_stock) as has_tracked_stock
    from {{ ref('stg_product_variants') }}
    group by product_id
)

select
    p.product_id as product_key,
    p.product_public_id,
    p.title,
    p.brand,
    p.gender,
    p.fragrance_family,
    p.fragrance_families,
    p.pack_size,
    p.popular_rank,
    p.is_active,
    p.created_at,
    {{ kyiv_date('p.created_at') }} as created_date,
    v.price_5ml,
    v.price_10ml,
    v.price_30ml,
    v.price_50ml,
    v.price_100ml,
    coalesce(v.has_tracked_stock, false) as has_tracked_stock,
    false as is_unknown
from products as p
left join variants as v on v.product_id = p.product_id

union all

select
    -1 as product_key,
    null::uuid as product_public_id,
    'Unknown (deleted) product' as title,
    null as brand,
    null as gender,
    null as fragrance_family,
    '{}'::text[] as fragrance_families,
    1 as pack_size,
    null::integer as popular_rank,
    false as is_active,
    null::timestamptz as created_at,
    null::date as created_date,
    null::numeric(12, 2) as price_5ml,
    null::numeric(12, 2) as price_10ml,
    null::numeric(12, 2) as price_30ml,
    null::numeric(12, 2) as price_50ml,
    null::numeric(12, 2) as price_100ml,
    false as has_tracked_stock,
    true as is_unknown
