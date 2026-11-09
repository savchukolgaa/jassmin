-- Registered customers. Emails are normalised (lower(trim())); `@example.com` test accounts are kept
-- here with `is_test_account` so the cleaning is auditable, and every model downstream drops them.
-- Personal data (name, email, phone) stops here: no model downstream selects it.
with source as (
    select * from {{ source('raw', 'users') }}
),

typed as (
    select
        {{ to_int('id') }} as user_id,
        {{ clean_text('full_name') }} as full_name,
        lower(trim(email::text)) as email_normalised,
        {{ clean_text('email') }} is distinct from lower(trim(email::text)) as had_unnormalised_email,
        {{ clean_text('phone') }} as phone,
        coalesce(lower({{ clean_text('acquisition_channel') }}), 'direct') as acquisition_channel,
        {{ clean_text('first_touch_source') }} as first_touch_source,
        {{ clean_text('first_touch_medium') }} as first_touch_medium,
        {{ clean_text('first_touch_campaign') }} as first_touch_campaign,
        {{ clean_text('city') }} as city,
        coalesce({{ to_bool('marketing_opt_in') }}, false) as marketing_opt_in,
        {{ clean_text('locale') }} as locale,
        {{ to_utc('created_at') }} as created_at,
        {{ to_utc('last_login_at') }} as last_login_at,
        {{ to_utc('email_verified_at') }} as email_verified_at
    from source
)

select
    *,
    phone is not null as has_phone,
    email_normalised like '%@example.com' as is_test_account
from typed
