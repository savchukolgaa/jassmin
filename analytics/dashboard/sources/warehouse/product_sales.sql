-- Revenue order lines with their perfume, by Kyiv day.
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    select l.order_date, p.product_key, p.title, p.brand, p.gender::text as gender,
        coalesce(p.fragrance_family, 'невідомо') as fragrance_family, p.pack_size, l.volume_ml,
        l.quantity, l.net_line_revenue
    from marts.fct_order_items as l
    join marts.dim_products as p on p.product_key = l.product_key
    where l.is_revenue
)

select q.*, false as is_placeholder from q
union all
select date '1970-01-01', 0, '', '', '', '', 1, 0, 0, 0::numeric, true
where not exists (select 1 from q)
