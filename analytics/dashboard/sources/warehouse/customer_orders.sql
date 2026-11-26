-- Revenue orders with their customer's first-order month, for new vs returning and cohorts.
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    select o.order_date, date_trunc('month', o.order_date)::date as order_month, o.customer_key,
        o.is_first_order, o.net_revenue,
        date_trunc('month', c.first_order_date)::date as cohort_month
    from marts.fct_orders as o
    join (
        select customer_key, min(order_date) as first_order_date
        from marts.fct_orders
        where is_revenue
        group by customer_key
    ) as c on c.customer_key = o.customer_key
    where o.is_revenue
)

select q.*, false as is_placeholder from q
union all
select date '1970-01-01', date '1970-01-01', '', false, 0::numeric, date '1970-01-01', true
where not exists (select 1 from q)
