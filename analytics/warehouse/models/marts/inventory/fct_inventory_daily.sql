-- One row per tracked size and Kyiv day, from its first ledger movement to the end of the data: units
-- sold, returned and received, the closing stock and whether it ran out. Rebuilt from the ledger
-- (not the app's inventory_daily view), because the raw layer's stock can go negative: the shortfall
-- is `backorder_units` and the closing stock is floored at 0. A day with a stock-out is
-- `is_demand_censored`: its sales are only a lower bound of the demand.
with movements as (
    select *, {{ kyiv_date('occurred_at') }} as day
    from {{ ref('stg_inventory_movements') }}
),

data_window as (
    select data_end_date from {{ ref('int_data_window') }}
),

spine as (
    select v.variant_id, d::date as day
    from (
        select variant_id, min(day) as first_day from movements group by variant_id
    ) as v
    cross join data_window as w
    cross join lateral generate_series(v.first_day, w.data_end_date, interval '1 day') as d
),

daily as (
    select
        variant_id,
        day,
        -coalesce(sum(quantity_delta) filter (where reason = 'sale'), 0) as units_sold,
        coalesce(sum(quantity_delta) filter (where reason in ('cancellation', 'return')), 0)
            as units_returned,
        coalesce(sum(quantity_delta) filter (where reason = 'receipt'), 0) as units_received,
        coalesce(sum(quantity_delta) filter (where reason in ('opening_balance', 'adjustment')), 0)
            as units_adjusted,
        sum(quantity_delta) as net_change,
        min(stock_after) as min_stock_after
    from movements
    group by variant_id, day
),

ledger as (
    select
        s.variant_id,
        s.day,
        coalesce(d.units_sold, 0) as units_sold,
        coalesce(d.units_returned, 0) as units_returned,
        coalesce(d.units_received, 0) as units_received,
        coalesce(d.units_adjusted, 0) as units_adjusted,
        d.min_stock_after,
        sum(coalesce(d.net_change, 0)) over (
            partition by s.variant_id order by s.day
        ) as ledger_closing_stock
    from spine as s
    left join daily as d on d.variant_id = s.variant_id and d.day = s.day
),

with_opening as (
    select
        *,
        lag(ledger_closing_stock) over (partition by variant_id order by day) as ledger_opening_stock
    from ledger
)

select
    l.variant_id,
    {{ product_key('v.product_id') }} as product_key,
    v.volume_ml,
    l.day,
    l.units_sold,
    l.units_returned,
    l.units_received,
    l.units_adjusted,
    -- Null on a size's first day: there was no stock before its first movement.
    case when l.ledger_opening_stock is not null then greatest(l.ledger_opening_stock, 0) end
        as opening_stock,
    greatest(l.ledger_closing_stock, 0) as closing_stock,
    greatest(-l.ledger_closing_stock, 0) as backorder_units,
    l.ledger_closing_stock as ledger_closing_stock,
    least(l.ledger_opening_stock, l.min_stock_after, l.ledger_closing_stock) <= 0 as is_stock_out,
    least(l.ledger_opening_stock, l.min_stock_after, l.ledger_closing_stock) <= 0
        as is_demand_censored
from with_opening as l
inner join {{ ref('stg_product_variants') }} as v on v.variant_id = l.variant_id
