-- Trio buyers and whether a full bottle followed within 60 days (mart_tester_conversion).
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    select trio_date, trio_month, days_to_bottle, converted, is_window_complete
    from marts.mart_tester_conversion
)

select q.*, false as is_placeholder from q
union all
select date '1970-01-01', date '1970-01-01', 0::numeric, false, false, true
where not exists (select 1 from q)
