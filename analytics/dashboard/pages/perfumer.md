---
title: ШІ-парфумер
---

```sql freshness
select extracted_at from warehouse.freshness
```

<DataDate data={freshness} />

Повідомлення до ШІ-парфумера (#166): скільки, як швидко відповідає, чи переходять на
запропоновані парфуми, чи замовляють їх протягом 7 днів, і як оцінюють відповіді. Текстів
повідомлень тут немає.

```sql last_30
with d as (select max(date_day)::date as last from (select * from warehouse.perfumer_daily where not is_placeholder))
select
    sum(messages) as messages,
    sum(conversations) as conversations,
    sum(errors)::double / nullif(sum(messages), 0) as error_rate,
    sum(answers_clicked)::double / nullif(sum(answers_with_picks), 0) as click_through,
    sum(answers_ordered_7d)::double / nullif(sum(answers_with_picks), 0) as conversion_7d,
    sum(ratings_up)::double / nullif(sum(ratings_up) + sum(ratings_down), 0) as up_share
from (select * from warehouse.perfumer_daily where not is_placeholder), d
where date_day > d.last - 30
```

## Останні 30 днів

<BigValue emptySet=pass emptyMessage="Ще немає даних" data={last_30} value=messages title="Повідомлень" fmt=num0 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={last_30} value=conversations title="Розмов" fmt=num0 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={last_30} value=click_through title="Перейшли на парфум" fmt=pct1 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={last_30} value=conversion_7d title="Замовили за 7 днів" fmt=pct1 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={last_30} value=up_share title="👍 серед оцінок" fmt=pct0 />
<BigValue emptySet=pass emptyMessage="Ще немає даних" data={last_30} value=error_rate title="Помилок" fmt=pct1 />

```sql weekly
select
    date_trunc('week', date_day) as week,
    sum(messages) as messages,
    sum(conversations) as conversations,
    avg(latency_p50_ms) / 1000 as p50_s,
    avg(latency_p95_ms) / 1000 as p95_s,
    sum(answers_clicked)::double / nullif(sum(answers_with_picks), 0) as click_through,
    sum(answers_ordered_7d)::double / nullif(sum(answers_with_picks), 0) as conversion_7d,
    sum(ratings_up) as ratings_up,
    sum(ratings_down) as ratings_down,
    sum(rate_limited) as rate_limited
from (select * from warehouse.perfumer_daily where not is_placeholder)
group by 1
order by 1
```

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={weekly} x=week y={['messages', 'conversations']} type=grouped
  title="Повідомлення й розмови за тиждень"
  seriesLabels={{messages: 'Повідомлень', conversations: 'Розмов'}} />

<LineChart emptySet=pass emptyMessage="Ще немає даних" data={weekly} x=week y={['p50_s', 'p95_s']} title="Час відповіді, секунд"
  seriesLabels={{p50_s: 'Медіана', p95_s: '95-й перцентиль'}} yFmt=num1 />

<LineChart emptySet=pass emptyMessage="Ще немає даних" data={weekly} x=week y={['click_through', 'conversion_7d']}
  title="Переходи й замовлення після відповіді" yFmt=pct0
  seriesLabels={{click_through: 'Перейшли', conversion_7d: 'Замовили за 7 днів'}} />

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={weekly} x=week y={['ratings_up', 'ratings_down']} title="Оцінки"
  seriesLabels={{ratings_up: '👍', ratings_down: '👎'}} />
