-- No double-fired events survive staging: no two events of the same session, visitor, type,
-- product and properties closer than `duplicate_event_seconds`. Returns the pairs that do.
select a.event_id, b.event_id as duplicate_event_id, a.created_at, b.created_at as duplicate_at
from {{ ref('stg_user_events') }} as a
inner join {{ ref('stg_user_events') }} as b
    on b.session_id = a.session_id
    and b.anonymous_id = a.anonymous_id
    and b.event_type = a.event_type
    and b.product_id is not distinct from a.product_id
    and b.event_properties is not distinct from a.event_properties
    and b.event_id <> a.event_id
    and b.created_at >= a.created_at
    and b.created_at - a.created_at < make_interval(secs => {{ var('duplicate_event_seconds') }})
    and (b.created_at > a.created_at or b.event_id > a.event_id)
