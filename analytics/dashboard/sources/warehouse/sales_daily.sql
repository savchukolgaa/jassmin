-- Revenue orders per Kyiv day (mart_sales_daily, #183).
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    select date_day, week_start, month_start, orders, first_orders, repeat_orders, net_revenue,
        avg_order_value, items, gift_card_redeemed
    from marts.mart_sales_daily
)

select q.*, false as is_placeholder from q
union all
select date '1970-01-01', date '1970-01-01', date '1970-01-01', 0, 0, 0, 0::numeric, 0::numeric,
    0, 0::numeric, true
where not exists (select 1 from q)
