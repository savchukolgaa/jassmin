-- The AI perfumer per Kyiv day (mart_perfumer_daily, #166).
-- Never empty: Evidence can't store a query with no rows (an empty Parquet file fails the build) and
-- infers each column's type from its values, and a new shop may have none yet (no orders before the
-- launch, no gift cards, the AI perfumer off). So with no rows it returns one typed placeholder row
-- (`is_placeholder`), which every page filters out.
with q as (
    select date_day, messages, conversations, rate_limited, errors, latency_p50_ms,
        latency_p95_ms, answers_with_picks, answers_clicked, answers_ordered_7d, ratings_up,
        ratings_down
    from marts.mart_perfumer_daily
)

select q.*, false as is_placeholder from q
union all
select date '1970-01-01', 0, 0, 0, 0, 0::double precision, 0::double precision, 0, 0, 0, 0, 0, true
where not exists (select 1 from q)
