---
title: Товари
---

```sql freshness
select extracted_at from warehouse.freshness
```

<DataDate data={freshness} />

<ButtonGroup name=days title="За останні">
  <ButtonGroupItem valueLabel="30 днів" value="30" />
  <ButtonGroupItem valueLabel="90 днів" value="90" default />
  <ButtonGroupItem valueLabel="365 днів" value="365" />
  <ButtonGroupItem valueLabel="Увесь час" value="100000" />
</ButtonGroup>

```sql lines
select *
from (select * from warehouse.product_sales where not is_placeholder)
where order_date > (select max(date_day)::date from (select * from warehouse.sales_daily where not is_placeholder)) - ${inputs.days}::integer
```

## Найкращі парфуми

```sql top_perfumes
select
    title || ' — ' || brand as perfume,
    sum(quantity) as units,
    sum(net_line_revenue) as revenue
from ${lines}
group by 1
order by revenue desc
limit 15
```

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={top_perfumes} x=perfume y=revenue swapXY=true title="Виторг за парфумом"
  yFmt='#,##0" ₴"' sort=false />

## Об'єми

```sql sizes
select
    case when pack_size > 1 then 'набір тестерів' else volume_ml || ' мл' end as size,
    sum(quantity) as units,
    sum(net_line_revenue) as revenue
from ${lines}
group by 1
order by revenue desc
```

<DataTable emptySet=pass emptyMessage="Ще немає даних" data={sizes}>
  <Column id=size title="Об'єм" />
  <Column id=units title="Одиниць" />
  <Column id=revenue title="Виторг" fmt='#,##0" ₴"' />
</DataTable>

## Родини ароматів

```sql families
select fragrance_family as family, sum(quantity) as units, sum(net_line_revenue) as revenue
from ${lines}
group by 1
order by revenue desc
```

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={families} x=family y=revenue swapXY=true title="Виторг за родиною"
  yFmt='#,##0" ₴"' sort=false />

## Подарункові сертифікати

```sql gift_cards
with sold as (
    select date_trunc('month', sale_date) as month, count(*) as cards, sum(amount) as sold
    from (select * from warehouse.gift_card_sales where not is_placeholder)
    group by 1
),
redeemed as (
    select month_start as month, sum(gift_card_redeemed) as redeemed
    from (select * from warehouse.sales_daily where not is_placeholder)
    group by 1
)
select
    coalesce(s.month, r.month) as month,
    coalesce(s.cards, 0) as cards,
    coalesce(s.sold, 0) as sold,
    coalesce(r.redeemed, 0) as redeemed
from sold as s
full join redeemed as r on r.month = s.month
where coalesce(s.cards, 0) > 0 or coalesce(r.redeemed, 0) > 0
order by month
```

{#if gift_cards.length > 0}

<BarChart emptySet=pass emptyMessage="Ще немає даних" data={gift_cards} x=month y={['sold', 'redeemed']} type=grouped
  title="Продано й витрачено сертифікатами" yFmt='#,##0" ₴"'
  seriesLabels={{sold: 'Продано', redeemed: 'Витрачено'}} />

{:else}

Сертифікатів ще не продавали й не витрачали.

{/if}

## Закінчуються

Об'єми з обліком залишку, яких за продажами останніх 28 днів вистачить на 14 днів або менше.

```sql running_out
select title || ' — ' || brand as perfume, volume_ml, closing_stock, daily_sales, days_of_cover
from (select * from warehouse.stock_cover where not is_placeholder)
where days_of_cover is not null and days_of_cover <= 14
order by days_of_cover, perfume
```

{#if running_out.length > 0}

<DataTable emptySet=pass emptyMessage="Ще немає даних" data={running_out} rows=20>
  <Column id=perfume title="Парфум" />
  <Column id=volume_ml title="мл" />
  <Column id=closing_stock title="Залишок" />
  <Column id=daily_sales title="Продажі на день" fmt=num2 />
  <Column id=days_of_cover title="Вистачить на, днів" />
</DataTable>

{:else}

Нічого не закінчується найближчими 14 днями.

{/if}
