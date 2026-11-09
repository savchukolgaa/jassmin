-- Each order's status over time, as intervals: `status` held from `valid_from` (inclusive) until
-- `valid_to` (exclusive; null for the current status). For point-in-time questions such as "was this
-- order returned as of the snapshot?", without reading the final `orders.status`.
select
    h.order_id,
    h.status,
    h.changed_at as valid_from,
    lead(h.changed_at) over (
        partition by h.order_id order by h.changed_at, h.status_change_id
    ) as valid_to
from {{ ref('stg_order_status_history') }} as h
inner join {{ ref('int_orders') }} as o on o.order_id = h.order_id
