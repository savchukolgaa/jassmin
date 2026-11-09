-- One row per change of an order's status (#128); `orders.status` is only the latest.
select
    {{ to_int('id') }} as status_change_id,
    {{ to_int('order_id') }} as order_id,
    lower({{ clean_text('status') }}) as status,
    {{ to_utc('changed_at') }} as changed_at,
    lower({{ clean_text('source') }}) as source
from {{ source('raw', 'order_status_history') }}
