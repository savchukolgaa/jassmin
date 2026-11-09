-- Discount rules and promo codes (#59, #124).
select
    {{ to_int('id') }} as discount_id,
    {{ clean_text('slug') }} as discount_slug,
    upper({{ clean_text('code') }}) as promo_code,
    lower({{ clean_text('kind') }}) as discount_kind,
    {{ to_money('value') }} as discount_value,
    {{ to_utc('starts_at') }} as starts_at,
    {{ to_utc('ends_at') }} as ends_at,
    coalesce({{ to_bool('active') }}, true) as is_active,
    {{ to_utc('created_at') }} as created_at
from {{ source('raw', 'discounts') }}
