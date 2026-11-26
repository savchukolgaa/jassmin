-- Gift cards bought (fct_gift_card_sales).
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    select sale_date, amount from marts.fct_gift_card_sales
)

select q.*, false as is_placeholder from q
union all
select date '1970-01-01', 0::numeric, true
where not exists (select 1 from q)
