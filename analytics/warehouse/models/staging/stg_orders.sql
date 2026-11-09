-- Orders. Cleaning:
-- * the currency upper-cased (`uah` -> `UAH`);
-- * the guest email normalised, and the customer's surrogate key built from it or the user id;
-- * a price typo (`total_amount` more than `price_outlier_ratio` x the line items) flagged, and the
--   total recomputed as subtotal - discount + shipping - gift card (the raw value stays in
--   `raw_total_amount`);
-- * an impossible timeline (`shipped_at` after `completed_at`) flagged and fixed from
--   order_status_history; when the history can't fix it, `shipped_at` becomes null.
-- Personal data (guest name, email, phone, address) stops here.
with source as (
    select * from {{ source('raw', 'orders') }}
),

typed as (
    select
        {{ to_int('id') }} as order_id,
        {{ to_int('user_id') }} as user_id,
        lower(trim(guest_email::text)) as email_normalised,
        {{ to_int('cart_id') }} as cart_id,
        {{ to_int('discount_id') }} as discount_id,
        lower({{ clean_text('status') }}) as status,
        lower({{ clean_text('payment_status') }}) as payment_status,
        lower({{ clean_text('payment_method') }}) as payment_method,
        lower({{ clean_text('cancel_reason') }}) as cancel_reason,
        coalesce({{ to_bool('free_shipping') }}, false) as free_shipping,
        {{ to_money('subtotal') }} as subtotal,
        coalesce({{ to_money('discount_amount') }}, 0) as discount_amount,
        coalesce({{ to_money('shipping_amount') }}, 0) as shipping_amount,
        coalesce({{ to_money('gift_card_amount') }}, 0) as gift_card_amount,
        {{ to_money('total_amount') }} as raw_total_amount,
        upper({{ clean_text('currency') }}) as currency,
        {{ clean_text('currency') }} is distinct from upper({{ clean_text('currency') }}) as had_lowercase_currency,
        {{ to_utc('created_at') }} as created_at,
        {{ to_utc('paid_at') }} as paid_at,
        {{ to_utc('shipped_at') }} as raw_shipped_at,
        {{ to_utc('arrived_at') }} as arrived_at,
        {{ to_utc('completed_at') }} as raw_completed_at,
        {{ to_utc('cancelled_at') }} as cancelled_at,
        {{ to_utc('returned_at') }} as returned_at,
        {{ to_utc('refunded_at') }} as refunded_at
    from source
),

items as (
    select order_id, sum(gross_line_revenue) as items_gross
    from {{ ref('stg_order_items') }}
    group by order_id
),

history as (
    select
        order_id,
        min(changed_at) filter (where status = 'shipped') as history_shipped_at,
        min(changed_at) filter (where status = 'completed') as history_completed_at
    from {{ ref('stg_order_status_history') }}
    group by order_id
),

flagged as (
    select
        o.*,
        h.history_shipped_at,
        h.history_completed_at,
        coalesce(
            i.items_gross > 0
            and o.raw_total_amount > {{ var('price_outlier_ratio') }} * i.items_gross,
            false
        ) as is_price_outlier,
        coalesce(o.raw_shipped_at > o.raw_completed_at, false) as has_impossible_timeline
    from typed as o
    left join items as i on i.order_id = o.order_id
    left join history as h on h.order_id = o.order_id
),

fixed as (
    select
        *,
        case
            when has_impossible_timeline then coalesce(history_completed_at, raw_completed_at)
            else raw_completed_at
        end as fixed_completed_at
    from flagged
)

select
    order_id,
    user_id,
    email_normalised like '%@example.com' as is_test_account,
    {{ customer_key('user_id', 'email_normalised') }} as customer_key,
    cart_id,
    discount_id,
    status,
    payment_status,
    payment_method,
    cancel_reason,
    free_shipping,
    subtotal,
    discount_amount,
    shipping_amount,
    gift_card_amount,
    case
        when is_price_outlier then subtotal - discount_amount + shipping_amount - gift_card_amount
        else raw_total_amount
    end as total_amount,
    raw_total_amount,
    is_price_outlier,
    currency,
    had_lowercase_currency,
    created_at,
    paid_at,
    case
        when not has_impossible_timeline then raw_shipped_at
        when history_shipped_at <= fixed_completed_at then history_shipped_at
    end as shipped_at,
    arrived_at,
    fixed_completed_at as completed_at,
    cancelled_at,
    returned_at,
    refunded_at,
    has_impossible_timeline,
    coalesce(
        has_impossible_timeline and history_shipped_at <= fixed_completed_at,
        false
    ) as timeline_fixed_from_history
from fixed
