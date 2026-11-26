---
title: Продажі
---

```sql freshness
select extracted_at from warehouse.freshness
```

<DataDate data={freshness} />

Виторг — сума товарів після знижок, без доставки, у замовленнях, які зараз оплачені, відправлені
або виконані. Замовлення рахується в день, коли його зробили; скасоване чи повернене пізніше
випадає зі свого дня.

<ButtonGroup name=grain title="Період">
  <ButtonGroupItem valueLabel="День" value="day" />
  <ButtonGroupItem valueLabel="Тиждень" value="week" default />
  <ButtonGroupItem valueLabel="Місяць" value="month" />
</ButtonGroup>

```sql by_period
with periods as (
    select
        date_trunc('${inputs.grain}', date_day) as period,
        sum(net_revenue) as revenue,
        sum(orders) as orders,
        sum(first_orders) as first_orders,
        sum(repeat_orders) as repeat_orders,
        sum(items) as items
    from (select * from warehouse.sales_daily where not is_placeholder)
    group by 1
)
select
    period,
    revenue,
    orders,
    first_orders,
    repeat_orders,
    items,
    revenue / nullif(orders, 0) as avg_order,
    lag(revenue) over (order by period) as prev_revenue,
    revenue / nullif(lag(revenue) over (order by period), 0) - 1 as revenue_change,
    orders / nullif(lag(orders) over (order by period), 0) - 1 as orders_change
from periods
order by period
```

```sql latest
select * from ${by_period} order by period desc limit 1 offset 1
```

Останній повний період і зміна до попереднього:

<BigValue emptySet=pass emptyMessage="Ще немає даних" data={latest} value=revenue title="Виторг" fmt='#,##0" ₴"'
  comparison=revenue_change comparisonFmt=pct1 comparisonTitle="до попереднього" />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={latest} value=orders title="Замовлень" fmt=num0
  comparison=orders_change comparisonFmt=pct1 comparisonTitle="до попереднього" />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={latest} value=avg_order title="Середній чек" fmt='#,##0" ₴"' />

<LineChart emptySet=pass emptyMessage="Ще немає даних" data={by_period} x=period y=revenue title="Виторг" yFmt='#,##0" ₴"' />

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={by_period} x=period y={['first_orders', 'repeat_orders']}
  title="Замовлення: перші й повторні" seriesLabels={{first_orders: 'Перші', repeat_orders: 'Повторні'}} />

<LineChart emptySet=pass emptyMessage="Ще немає даних" data={by_period} x=period y=avg_order title="Середній чек" yFmt='#,##0" ₴"' />

<DataTable emptySet=pass emptyMessage="Ще немає даних" data={by_period} sort="period desc" rows=12>
  <Column id=period title="Період" />
  <Column id=revenue title="Виторг" fmt='#,##0" ₴"' />
  <Column id=revenue_change title="Зміна" fmt=pct1 contentType=delta />
  <Column id=orders title="Замовлень" />
  <Column id=avg_order title="Середній чек" fmt='#,##0" ₴"' />
  <Column id=items title="Одиниць" />
</DataTable>
