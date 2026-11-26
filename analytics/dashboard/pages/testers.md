---
title: Тестери → флакон
---

```sql freshness
select extracted_at from warehouse.freshness
```

<DataDate data={freshness} />

Хто купив тріо тестерів (акція «3 × 10 мл» або набір тестерів), чи замовив повний флакон
(30, 50 або 100 мл) протягом 60 днів після першого тріо. Рахуємо лише тих, у кого 60 днів уже
минули, щоб недавні покупці не виглядали як «не купили».

```sql overall
select
    count(*) as buyers,
    count(*) filter (where converted) as converted,
    count(*) filter (where converted)::double / nullif(count(*), 0) as share,
    median(days_to_bottle) as median_days
from (select * from warehouse.tester_conversion where not is_placeholder)
where is_window_complete
```

```sql pending
select count(*) as buyers from (select * from warehouse.tester_conversion where not is_placeholder) where not is_window_complete
```

<BigValue emptySet=pass emptyMessage="Ще немає даних" data={overall} value=share title="Купили флакон за 60 днів" fmt=pct1 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={overall} value=buyers title="Покупців тріо" fmt=num0 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={overall} value=median_days title="Медіана днів до флакона" fmt=num0 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={pending} value=buyers title="Ще в межах 60 днів" fmt=num0 />

```sql by_month
select
    trio_month as month,
    count(*) as buyers,
    count(*) filter (where converted) as converted,
    count(*) filter (where converted)::double / count(*) as share
from (select * from warehouse.tester_conversion where not is_placeholder)
where is_window_complete
group by 1
order by 1
```

<LineChart emptySet=pass emptyMessage="Ще немає даних" data={by_month} x=month y=share title="Частка за місяцем першого тріо" yFmt=pct0 />

<DataTable emptySet=pass emptyMessage="Ще немає даних" data={by_month} sort="month desc">
  <Column id=month title="Місяць тріо" fmt=mmm-yyyy />
  <Column id=buyers title="Покупців тріо" />
  <Column id=converted title="Купили флакон" />
  <Column id=share title="Частка" fmt=pct1 />
</DataTable>
