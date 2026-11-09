-- The ledger sums to stock (#130): for every size with movements, sum(quantity_delta) equals
-- product_variants.stock_quantity, and the last day of fct_inventory_daily closes on it. Returns the
-- sizes where either doesn't hold.
with ledger as (
    select variant_id, sum(quantity_delta) as ledger_stock
    from {{ ref('stg_inventory_movements') }}
    group by variant_id
),

last_day as (
    select distinct on (variant_id) variant_id, ledger_closing_stock
    from {{ ref('fct_inventory_daily') }}
    order by variant_id, day desc
)

select v.variant_id, v.stock_quantity, l.ledger_stock, d.ledger_closing_stock
from ledger as l
inner join {{ ref('stg_product_variants') }} as v on v.variant_id = l.variant_id
left join last_day as d on d.variant_id = l.variant_id
where l.ledger_stock <> v.stock_quantity
    or d.ledger_closing_stock is distinct from v.stock_quantity
