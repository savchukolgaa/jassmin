-- The span the data covers: from the first signup, visit or order to the last recorded activity.
-- The date dimension, the inventory spine and the churn label's horizon are measured against it.
with bounds as (
    select min(created_at) as first_at, max(created_at) as last_at from {{ ref('stg_users') }}
    union all
    select min(started_at), max(coalesce(ended_at, started_at)) from {{ ref('stg_sessions') }}
    union all
    select min(created_at), max(created_at) from {{ ref('stg_user_events') }}
    union all
    select min(created_at), max(created_at) from {{ ref('stg_orders') }}
    union all
    select min(changed_at), max(changed_at) from {{ ref('stg_order_status_history') }}
    union all
    select min(occurred_at), max(occurred_at) from {{ ref('stg_inventory_movements') }}
)

select
    min(first_at) as data_start_at,
    max(last_at) as data_end_at,
    {{ kyiv_date('min(first_at)') }} as data_start_date,
    {{ kyiv_date('max(last_at)') }} as data_end_date
from bounds
