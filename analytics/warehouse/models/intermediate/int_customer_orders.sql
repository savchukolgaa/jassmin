-- Each order's place in its customer's history: the sequence number (1 = first order, counting every
-- order placed) and the days since the customer's previous order.
select
    order_id,
    customer_key,
    created_at,
    row_number() over (
        partition by customer_key order by created_at, order_id
    ) as order_seq,
    {{ days_between(
        'lag(created_at) over (partition by customer_key order by created_at, order_id)',
        'created_at'
    ) }} as days_since_prev_order
from {{ ref('int_orders') }}
