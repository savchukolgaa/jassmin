---
title: Клієнти
---

```sql freshness
select extracted_at from warehouse.freshness
```

<DataDate data={freshness} />

Клієнт — зареєстрований покупець або гість (за знеособленим email: повторні замовлення гостя —
один клієнт). Рахуються замовлення, які оплачені, відправлені або виконані.

## Нові й повторні

```sql new_returning
select
    order_month as month,
    count(distinct customer_key) filter (where is_first_order) as new_customers,
    count(distinct customer_key) filter (where not is_first_order) as returning_customers
from (select * from warehouse.customer_orders where not is_placeholder)
group by 1
order by 1
```

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={new_returning} x=month y={['new_customers', 'returning_customers']}
  title="Клієнти, що купили за місяць"
  seriesLabels={{new_customers: 'Нові', returning_customers: 'Повторні'}} />

## Когорти

Частка клієнтів кожної когорти (місяць першого замовлення), які купили знову через N місяців.

```sql cohorts
with activity as (
    select distinct
        cohort_month,
        customer_key,
        date_diff('month', cohort_month, order_month) as months_since
    from (select * from warehouse.customer_orders where not is_placeholder)
),
sizes as (
    select cohort_month, count(distinct customer_key) as cohort_size
    from activity
    where months_since = 0
    group by 1
)
select
    strftime(a.cohort_month, '%Y-%m') as cohort,
    a.months_since,
    count(distinct a.customer_key)::double / s.cohort_size as retention,
    s.cohort_size
from activity as a
join sizes as s on s.cohort_month = a.cohort_month
where a.months_since between 1 and 12
    and a.cohort_month >= (select max(order_month) from (select * from warehouse.customer_orders where not is_placeholder)) - interval 24 month
group by a.cohort_month, a.months_since, s.cohort_size
order by a.cohort_month, a.months_since
```

<Heatmap emptySet=pass emptyMessage="Ще немає даних" data={cohorts} x=months_since y=cohort value=retention valueFmt=pct0
  title="Повторні покупки за місяцями після першої" />

## Ризик відтоку

Сегменти за давністю й частотою покупок (RFM), без ML-моделі:
**нові** — перше замовлення не старше 90 днів; **разові** — одне замовлення, давніше;
**активні** — останнє замовлення не давніше, ніж їхня звична перерва × 1,5 (щонайменше 60 днів);
**під ризиком** — давніше, до 180 днів; **втрачені** — понад 180 днів.

```sql segments
select
    case segment
        when 'new' then '1. Нові'
        when 'active' then '2. Активні'
        when 'at_risk' then '3. Під ризиком'
        when 'lost' then '4. Втрачені'
        when 'one_time' then '5. Разові'
    end as segment,
    count(*) as customers,
    sum(monetary) as revenue,
    median(recency_days) as median_recency
from (select * from warehouse.customer_rfm where not is_placeholder)
group by 1
order by 1
```

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={segments} x=segment y=customers title="Клієнтів у сегменті" sort=false />

<DataTable emptySet=pass emptyMessage="Ще немає даних" data={segments}>
  <Column id=segment title="Сегмент" />
  <Column id=customers title="Клієнтів" />
  <Column id=revenue title="Виторг за весь час" fmt='#,##0" ₴"' />
  <Column id=median_recency title="Медіана днів від останнього" fmt=num0 />
</DataTable>

## Міста

```sql cities
select city, count(*) as customers, sum(monetary) as revenue
from (select * from warehouse.customer_rfm where not is_placeholder)
group by 1
order by customers desc
limit 15
```

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={cities} x=city y=customers swapXY=true title="Клієнтів за містом" sort=false />

## Канали залучення

```sql channels
select acquisition_channel as channel, count(*) as customers, sum(monetary) as revenue
from (select * from warehouse.customer_rfm where not is_placeholder)
group by 1
order by customers desc
```

<DataTable emptySet=pass emptyMessage="Ще немає даних" data={channels}>
  <Column id=channel title="Канал" />
  <Column id=customers title="Клієнтів" />
  <Column id=revenue title="Виторг за весь час" fmt='#,##0" ₴"' />
</DataTable>
