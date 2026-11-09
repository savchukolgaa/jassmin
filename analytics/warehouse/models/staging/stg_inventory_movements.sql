-- The stock ledger (#130). #131 lets stock go negative during stock-outs (backorders), which the app
-- itself refuses; the rows are kept as they are and the shortfall is flagged.
with movements as (
    select
        {{ to_int('id') }} as movement_id,
        {{ to_int('variant_id') }} as variant_id,
        {{ to_utc('occurred_at') }} as occurred_at,
        lower({{ clean_text('reason') }}) as reason,
        {{ to_int('quantity_delta') }} as quantity_delta,
        {{ to_int('stock_after') }} as stock_after,
        {{ to_int('order_id') }} as order_id,
        lower({{ clean_text('source') }}) as source
    from {{ source('raw', 'inventory_movements') }}
)

select
    *,
    stock_after < 0 as is_backorder,
    greatest(-stock_after, 0) as backorder_units
from movements
