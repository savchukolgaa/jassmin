-- Carts: active, converted into an order, or abandoned after 24 h without activity (#19).
select
    {{ to_int('id') }} as cart_id,
    {{ to_int('user_id') }} as user_id,
    {{ to_uuid('session_id') }} as session_id,
    lower({{ clean_text('status') }}) as status,
    {{ to_int('discount_id') }} as discount_id,
    {{ to_utc('created_at') }} as created_at,
    {{ to_utc('updated_at') }} as updated_at,
    {{ to_utc('abandoned_at') }} as abandoned_at,
    {{ to_utc('reminder_sent_at') }} as reminder_sent_at,
    {{ to_utc('restored_at') }} as restored_at
from {{ source('raw', 'carts') }}
