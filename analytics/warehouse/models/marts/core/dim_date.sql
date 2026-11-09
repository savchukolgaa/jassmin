-- One row per Kyiv calendar day, from 1 January of the first year with data to 31 December of the
-- last, with the Ukrainian gifting peaks a perfume shop's sales follow.
with data_window as (
    select * from {{ ref('int_data_window') }}
),

days as (
    select d::date as date_day
    from data_window
    cross join lateral generate_series(
        date_trunc('year', data_start_date)::date,
        (date_trunc('year', data_end_date) + interval '1 year - 1 day')::date,
        interval '1 day'
    ) as d
)

select
    date_day,
    extract(year from date_day)::integer as year,
    extract(quarter from date_day)::integer as quarter,
    extract(month from date_day)::integer as month,
    trim(to_char(date_day, 'Month')) as month_name,
    date_trunc('month', date_day)::date as month_start,
    extract(isoyear from date_day)::integer as iso_year,
    extract(week from date_day)::integer as iso_week,
    date_trunc('week', date_day)::date as week_start,
    extract(isodow from date_day)::integer as day_of_week,
    trim(to_char(date_day, 'Day')) as day_name,
    extract(isodow from date_day) in (6, 7) as is_weekend,
    (extract(month from date_day) = 3 and extract(day from date_day) = 8) as is_womens_day,
    (extract(month from date_day) = 2 and extract(day from date_day) = 14) as is_valentines_day,
    (extract(month from date_day) = 12 and extract(day from date_day) = 6) as is_st_nicholas_day,
    (
        (extract(month from date_day) = 12 and extract(day from date_day) = 31)
        or (extract(month from date_day) = 1 and extract(day from date_day) = 1)
    ) as is_new_year,
    -- The fourth Friday of November.
    (
        extract(month from date_day) = 11
        and extract(isodow from date_day) = 5
        and extract(day from date_day) between 22 and 28
    ) as is_black_friday,
    -- The weeks of gift buying before 8 March, 14 February, St Nicholas Day and New Year.
    (
        (extract(month from date_day) = 3 and extract(day from date_day) <= 8)
        or (extract(month from date_day) = 2 and extract(day from date_day) between 7 and 14)
        or (extract(month from date_day) = 12)
    ) as is_gift_season
from days
