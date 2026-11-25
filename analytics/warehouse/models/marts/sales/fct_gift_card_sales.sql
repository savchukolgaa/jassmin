-- One row per gift card bought (#125, #183): a succeeded card payment with no order is a gift card
-- purchase (the app's `payments_target_check`: an attempt pays an order or a gift card). The card's
-- code, buyer and recipient never reach the warehouse; what is spent with cards is
-- `fct_orders.gift_card_amount`. The generator (#131) makes no gift cards, so on `synth` it holds
-- only the fixture's.
select
    payment_id,
    {{ kyiv_date('coalesce(completed_at, created_at)') }} as sale_date,
    coalesce(completed_at, created_at) as sold_at,
    amount,
    provider
from {{ ref('stg_payments') }}
where order_id is null
    and status = 'succeeded'
