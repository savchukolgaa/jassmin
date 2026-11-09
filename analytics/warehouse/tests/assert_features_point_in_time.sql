-- mart_customer_features is point-in-time correct: no feature read data at or after its snapshot.
-- `max_input_at` is the latest timestamp any feature of the row read. Returns the rows that leak.
select customer_key, snapshot_at, max_input_at
from {{ ref('mart_customer_features') }}
where max_input_at >= snapshot_at
