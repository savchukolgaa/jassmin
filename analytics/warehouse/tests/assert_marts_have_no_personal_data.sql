-- Personal data doesn't leave staging: no column of an intermediate model or a mart is a name, an
-- email, a phone or an address. Boolean flags (e.g. `has_phone`) can't hold one and are allowed.
-- Returns the offending columns.
--
-- Run after every model it inspects (the query itself reads information_schema):
-- depends_on: {{ ref('int_data_window') }} {{ ref('int_orders') }} {{ ref('int_order_lines') }}
-- depends_on: {{ ref('int_customer_orders') }} {{ ref('int_order_status_intervals') }}
-- depends_on: {{ ref('int_sessions') }} {{ ref('int_events') }}
-- depends_on: {{ ref('dim_date') }} {{ ref('dim_products') }} {{ ref('dim_customers') }}
-- depends_on: {{ ref('fct_orders') }} {{ ref('fct_order_items') }} {{ ref('fct_sessions') }}
-- depends_on: {{ ref('fct_events') }} {{ ref('fct_inventory_daily') }}
-- depends_on: {{ ref('mart_customer_features') }}
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema in ('intermediate', 'marts')
    and data_type <> 'boolean'
    and column_name ~ '(full_name|first_name|last_name|guest_name|email|phone|address)'
