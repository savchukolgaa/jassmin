-- Tracked sizes and how long their stock lasts: the closing stock on the last day against the
-- average daily sales of the last 28 days.
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    with last_day as (select max(day) as day from marts.fct_inventory_daily),
    recent as (
        select i.variant_id, sum(i.units_sold) / 28.0 as daily_sales
        from marts.fct_inventory_daily as i
        cross join last_day as d
        where i.day > d.day - 28
        group by i.variant_id
    )
    select p.title, p.brand, i.volume_ml, i.closing_stock,
        round(r.daily_sales::numeric, 2) as daily_sales,
        case when r.daily_sales > 0 then floor(i.closing_stock / r.daily_sales) end as days_of_cover
    from marts.fct_inventory_daily as i
    cross join last_day as d
    join recent as r on r.variant_id = i.variant_id
    join marts.dim_products as p on p.product_key = i.product_key
    where i.day = d.day
)

select q.*, false as is_placeholder from q
union all
select '', '', 0, 0, 0::numeric, 0::numeric, true
where not exists (select 1 from q)
