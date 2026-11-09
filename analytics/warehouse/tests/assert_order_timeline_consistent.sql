-- No order is shipped after it was completed, or shipped or completed before it was placed. Returns
-- the orders whose cleaned timeline is still impossible.
select order_id, created_at, shipped_at, completed_at
from {{ ref('fct_orders') }}
where shipped_at > completed_at
    or completed_at < created_at
    or shipped_at < created_at
