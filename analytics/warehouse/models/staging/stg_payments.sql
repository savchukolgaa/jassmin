-- Card payment attempts (#44): pending, then succeeded or failed. The currency is upper-cased (#131
-- writes some as `uah`).
select
    {{ to_int('id') }} as payment_id,
    {{ to_int('order_id') }} as order_id,
    lower({{ clean_text('provider') }}) as provider,
    lower({{ clean_text('status') }}) as status,
    {{ to_money('amount') }} as amount,
    upper({{ clean_text('currency') }}) as currency,
    {{ clean_text('currency') }} is distinct from upper({{ clean_text('currency') }}) as had_lowercase_currency,
    {{ to_utc('created_at') }} as created_at,
    {{ to_utc('completed_at') }} as completed_at
from {{ source('raw', 'payments') }}
