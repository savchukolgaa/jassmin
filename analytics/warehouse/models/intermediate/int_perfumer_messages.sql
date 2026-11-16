-- One row per AI perfumer message (#166) of a real visit: the `perfumer_message` properties as typed
-- columns, the latest rating of the answer, whether a recommended card was clicked, and whether the
-- same visitor (the anonymous id, or the user once logged in) ordered a recommended or a clicked
-- perfume within 7 days. Orders come from the visitor's `purchase` events (their `order_id`) and
-- the real order lines, so a guest's order counts too. No text is ever stored in these events.
-- A table, not a view like the other int_* models: the attribution joins scan every event, and its
-- tests and the daily mart would otherwise repeat them.
{{ config(materialized='table') }}

with events as (
    select e.*, s.customer_key
    from {{ ref('stg_user_events') }} as e
    inner join {{ ref('int_sessions') }} as s on s.session_id = e.session_id
),

messages as (
    select
        event_id,
        (event_properties ->> 'reply_id')::uuid as reply_id,
        session_id,
        customer_key,
        anonymous_id,
        user_id,
        created_at as message_at,
        (event_properties ->> 'turn')::integer as turn,
        event_properties ->> 'entry' as entry,
        event_properties ->> 'model' as model,
        event_properties ->> 'error' as error,
        (event_properties ->> 'latency_ms')::integer as latency_ms,
        (event_properties ->> 'asked_question')::boolean as asked_question,
        jsonb_array_length(coalesce(event_properties -> 'tool_calls', '[]'::jsonb)) as tool_call_count,
        coalesce(event_properties -> 'pick_ids', '[]'::jsonb) as pick_ids
    from events
    where event_type = 'perfumer_message'
),

picks as (
    select m.event_id, p.product_id, {{ product_key('p.product_id') }} as product_key
    from messages as m
    cross join lateral jsonb_array_elements_text(m.pick_ids) as pick (product_public_id)
    inner join {{ ref('stg_products') }} as p on p.product_public_id = pick.product_public_id::uuid
),

ratings as (
    select distinct on (reply_id)
        reply_id,
        rating
    from (
        select (event_properties ->> 'reply_id')::uuid as reply_id,
            event_properties ->> 'rating' as rating,
            created_at,
            event_id
        from events
        where event_type = 'perfumer_feedback'
    ) as feedback
    order by reply_id, created_at desc, event_id desc
),

clicks as (
    select anonymous_id, user_id, product_id, created_at
    from events
    where event_type = 'product_click' and event_properties ->> 'list_id' = 'perfumer'
),

-- A click on one of the answer's picks by the same visitor, within an hour of the answer.
clicked as (
    select distinct m.event_id, p.product_key
    from messages as m
    inner join picks as p on p.event_id = m.event_id
    inner join clicks as c
        on c.product_id = p.product_id
        and (c.anonymous_id = m.anonymous_id or c.user_id = m.user_id)
        and c.created_at >= m.message_at
        and c.created_at < m.message_at + interval '1 hour'
),

ordered_products as (
    select e.anonymous_id, e.user_id, e.created_at as ordered_at, l.product_key
    from events as e
    inner join {{ ref('int_order_lines') }} as l
        on l.order_id = (e.event_properties ->> 'order_id')::integer
    where e.event_type = 'purchase'
),

-- Products of the answer (`candidates`) the same visitor ordered within 7 days after it.
ordered as (
    select distinct m.event_id, candidates.kind
    from messages as m
    inner join (
        select event_id, product_key, 'pick' as kind from picks
        union all
        select event_id, product_key, 'clicked' as kind from clicked
    ) as candidates on candidates.event_id = m.event_id
    inner join ordered_products as o
        on o.product_key = candidates.product_key
        and (o.anonymous_id = m.anonymous_id or o.user_id = m.user_id)
        and o.ordered_at >= m.message_at
        and o.ordered_at < m.message_at + interval '7 days'
)

select
    m.event_id,
    m.reply_id,
    m.session_id,
    m.customer_key,
    m.message_at,
    (m.message_at at time zone '{{ var("timezone") }}')::date as message_date,
    m.turn,
    m.entry,
    m.model,
    m.error,
    m.error is null as is_answered,
    m.latency_ms,
    m.tool_call_count,
    jsonb_array_length(m.pick_ids) as pick_count,
    m.asked_question,
    r.rating as latest_rating,
    exists (select 1 from clicked as c where c.event_id = m.event_id) as clicked_pick,
    exists (
        select 1 from ordered as o where o.event_id = m.event_id and o.kind = 'pick'
    ) as ordered_pick_7d,
    exists (
        select 1 from ordered as o where o.event_id = m.event_id and o.kind = 'clicked'
    ) as ordered_clicked_7d
from messages as m
left join ratings as r on r.reply_id = m.reply_id
