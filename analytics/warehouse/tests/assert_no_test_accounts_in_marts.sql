-- @example.com test accounts never reach the marts, neither as registered users nor as guest orders.
-- Returns the marts' rows that belong to one.
with test_keys as (
    select {{ customer_key('user_id') }} as customer_key
    from {{ ref('stg_users') }}
    where is_test_account
    union
    select customer_key from {{ ref('stg_orders') }} where is_test_account
)

select 'dim_customers' as model, customer_key from {{ ref('dim_customers') }}
where customer_key in (select customer_key from test_keys)
union all
select 'fct_orders', customer_key from {{ ref('fct_orders') }}
where customer_key in (select customer_key from test_keys)
union all
select 'fct_sessions', customer_key from {{ ref('fct_sessions') }}
where customer_key in (select customer_key from test_keys)
union all
select 'fct_events', customer_key from {{ ref('fct_events') }}
where customer_key in (select customer_key from test_keys)
union all
select 'mart_customer_features', customer_key from {{ ref('mart_customer_features') }}
where customer_key in (select customer_key from test_keys)
