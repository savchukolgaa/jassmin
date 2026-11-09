-- The ledger is internally consistent: for every size, the running sum of quantity_delta equals each
-- movement's stock_after. Returns the movements where it doesn't.
--
-- The sum runs in the ledger's write order (movement_id), which is the order stock_after was
-- computed in. occurred_at can disagree with it by a few minutes: #131's generator writes some
-- supplier receipts after a sale that happened later.
with running as (
    select
        movement_id,
        variant_id,
        occurred_at,
        stock_after,
        sum(quantity_delta) over (partition by variant_id order by movement_id) as running_stock
    from {{ ref('stg_inventory_movements') }}
)

select * from running where running_stock <> stock_after
