-- The behavioural event stream (#18, #129). Cleaning:
-- * a timestamp without an offset is UTC (#131's naive-timestamp anomaly), and flagged;
-- * a missing device_type is 'unknown';
-- * a double-fired event (the same session, visitor, type, product and properties less than
--   `duplicate_event_seconds` after the previous one) is dropped. The properties must match too: a
--   double fire repeats the payload, while two page views a moment apart (different pages) or two
--   quick "+" clicks (different cart values) are real.
with source as (
    select * from {{ source('raw', 'user_events') }}
),

typed as (
    select
        {{ to_uuid('event_id') }} as event_id,
        {{ to_int('user_id') }} as user_id,
        {{ clean_text('anonymous_id') }} as anonymous_id,
        {{ to_uuid('session_id') }} as session_id,
        lower({{ clean_text('event_type') }}) as event_type,
        {{ to_int('product_id') }} as product_id,
        {{ to_jsonb('event_properties') }} as event_properties,
        {{ clean_text('source') }} as source,
        {{ clean_text('medium') }} as medium,
        {{ clean_text('campaign') }} as campaign,
        coalesce(lower({{ clean_text('device_type') }}), 'unknown') as device_type,
        {{ to_utc('created_at') }} as created_at,
        {{ is_naive_timestamp('created_at') }} as had_naive_timestamp
    from source
),

ordered as (
    select
        *,
        lag(created_at) over (
            partition by session_id, anonymous_id, event_type, product_id, event_properties
            order by created_at, event_id
        ) as previous_same_event_at
    from typed
)

select
    event_id,
    user_id,
    anonymous_id,
    session_id,
    event_type,
    product_id,
    event_properties,
    source,
    medium,
    campaign,
    device_type,
    created_at,
    had_naive_timestamp
from ordered
where previous_same_event_at is null
    or created_at - previous_same_event_at
        >= make_interval(secs => {{ var('duplicate_event_seconds') }})
