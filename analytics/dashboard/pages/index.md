---
title: Jassmin — огляд
---

```sql freshness
select extracted_at from warehouse.freshness
```

<DataDate data={freshness} />

Справжні дані магазину: замовлення, товари, клієнти та ШІ-парфумер. Імен, email, телефонів,
адрес і текстів чатів тут немає: лише знеособлена нічна копія (#183). «Виторг» — сума товарів
після знижок, без доставки, у замовленнях, які оплачені, відправлені або виконані.

```sql periods
with s as (select * from (select * from warehouse.sales_daily where not is_placeholder)),
last as (select max(date_day)::date as d from s),
agg as (
    select
        sum(case when date_day > d - 7 then net_revenue end) as revenue_7d,
        sum(case when date_day <= d - 7 and date_day > d - 14 then net_revenue end) as revenue_prev_7d,
        sum(case when date_day > d - 7 then orders end) as orders_7d,
        sum(case when date_day <= d - 7 and date_day > d - 14 then orders end) as orders_prev_7d,
        sum(case when date_day > d - 30 then net_revenue end) as revenue_30d,
        sum(case when date_day <= d - 30 and date_day > d - 60 then net_revenue end) as revenue_prev_30d,
        sum(case when date_day > d - 30 then orders end) as orders_30d,
        sum(case when date_day <= d - 30 and date_day > d - 60 then orders end) as orders_prev_30d
    from s, last
)
select
    *,
    revenue_7d / nullif(orders_7d, 0) as aov_7d,
    revenue_30d / nullif(orders_30d, 0) as aov_30d,
    revenue_7d / nullif(revenue_prev_7d, 0) - 1 as revenue_7d_change,
    orders_7d / nullif(orders_prev_7d, 0) - 1 as orders_7d_change,
    revenue_30d / nullif(revenue_prev_30d, 0) - 1 as revenue_30d_change,
    orders_30d / nullif(orders_prev_30d, 0) - 1 as orders_30d_change
from agg
```

## Останні 7 днів

<BigValue emptySet=pass emptyMessage="Ще немає даних" data={periods} value=revenue_7d title="Виторг" fmt='#,##0" ₴"'
  comparison=revenue_7d_change comparisonFmt=pct1 comparisonTitle="до попередніх 7 днів" />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={periods} value=orders_7d title="Замовлень" fmt=num0
  comparison=orders_7d_change comparisonFmt=pct1 comparisonTitle="до попередніх 7 днів" />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={periods} value=aov_7d title="Середній чек" fmt='#,##0" ₴"' />

## Останні 30 днів

<BigValue emptySet=pass emptyMessage="Ще немає даних" data={periods} value=revenue_30d title="Виторг" fmt='#,##0" ₴"'
  comparison=revenue_30d_change comparisonFmt=pct1 comparisonTitle="до попередніх 30 днів" />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={periods} value=orders_30d title="Замовлень" fmt=num0
  comparison=orders_30d_change comparisonFmt=pct1 comparisonTitle="до попередніх 30 днів" />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={periods} value=aov_30d title="Середній чек" fmt='#,##0" ₴"' />

## Розділи

- [Продажі](/sales): виторг, замовлення й середній чек за днями, тижнями й місяцями.
- [Товари](/products): найкращі парфуми й об'єми, родини ароматів, подарункові сертифікати,
  залишки, що закінчуються.
- [Тестери → флакон](/testers): частка покупців тріо, які за 60 днів замовили повний флакон.
- [Клієнти](/customers): нові й повторні, когорти, міста, канали, ризик відтоку.
- [ШІ-парфумер](/perfumer): повідомлення, швидкість, переходи, замовлення, оцінки.
