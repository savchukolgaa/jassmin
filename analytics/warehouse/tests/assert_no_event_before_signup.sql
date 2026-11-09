-- No logged-in event happens before its user signed up. This also catches a naive timestamp read in
-- the wrong time zone (Kyiv instead of UTC moves it 2-3 hours earlier). Returns the offending events.
select e.event_id, e.user_id, e.created_at, u.created_at as signup_at
from {{ ref('stg_user_events') }} as e
inner join {{ ref('stg_users') }} as u on u.user_id = e.user_id
where e.created_at < u.created_at
