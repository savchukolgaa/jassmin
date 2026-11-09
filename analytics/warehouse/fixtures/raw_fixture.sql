-- A small raw layer in the shape #131's generator writes (`raw.<app table>`, the app's column names,
-- every column `text`, no constraints), with one or more rows for each anomaly in #131's catalogue.
-- tests_py/test_build.py loads it into a throwaway jassmin_synth_<suffix> database and runs
-- `dbt build`, so the warehouse is tested without the generator. Times are Kyiv (+02:00 in winter,
-- +03:00 in summer) unless a row is the naive-UTC anomaly.
--
-- Cast of characters:
--   user 1  Olena: two revenue orders (one returned), a later visit; ordinary.
--   user 2  Ivan: email with stray spaces and capitals, no phone; a x10 price typo, lowercase `uah`,
--           shipped after completion, a deleted product, a naive-UTC event, a payment_failed order.
--   user 3  qa1@example.com: a test account with an order and a visit (must vanish downstream).
--   user 4  Maria: an unclaimed cash-on-delivery parcel, an abandoned cart, a late order.
--   guest   guest.buyer@ukr.net: two guest orders with differently written emails (one customer).
--   bot     an anonymous session with 80 product views 0.7 s apart.

drop schema if exists raw cascade;
create schema raw;

create table raw.users (
    id text, full_name text, email text, password_hash text, phone text, acquisition_channel text,
    role text, last_login_at text, created_at text, first_touch_source text, first_touch_medium text,
    first_touch_campaign text, email_verified_at text, password_changed_at text, city text,
    marketing_opt_in text, locale text
);
insert into raw.users values
    ('1', 'Олена Коваль', 'olena@gmail.com', 'x', '+380501112233', 'instagram', 'customer',
     '2025-08-31T19:00:00+03:00', '2025-01-05T10:00:00+02:00', 'instagram', 'social', null,
     '2025-01-05T10:10:00+02:00', null, 'Київ', 'true', 'uk'),
    ('2', 'Іван Петренко', '  Ivan.Petrenko@Gmail.com ', 'x', null, 'telegram', 'customer',
     null, '2025-01-10T10:20:00+02:00', 'telegram', 'social', 'winter', null, null, 'Львів',
     'false', 'uk'),
    ('3', 'QA Tester', 'qa1@example.com', 'x', '+380000000000', 'direct', 'customer',
     null, '2025-01-02T09:00:00+02:00', null, null, null, null, null, 'Київ', 'false', 'en'),
    ('4', 'Марія Шевчук', 'maria@ukr.net', 'x', '+380671234567', 'direct', 'customer',
     null, '2025-03-01T11:50:00+02:00', 'direct', 'none', null, null, null, 'Одеса', 'true', 'uk');

create table raw.products (
    id text, public_id text, title text, brand text, gender text, fragrance_family text,
    fragrance_families text, notes text, store_code text, popular_rank text, price text,
    volume_ml text, pack_size text, stock_quantity text, active text, created_at text
);
insert into raw.products values
    ('1', '01900000-0000-7000-8000-000000000001', 'Sauvage', 'Dior', 'men', 'свіжі',
     '{свіжі,деревні}', '{}', '3-D', '1', '119.00', '5', '1', '0', 'true',
     '2024-12-01T10:00:00+02:00'),
    ('2', '01900000-0000-7000-8000-000000000002', 'J''adore', 'Dior', 'women', 'квіткові',
     '{квіткові,фруктові}', '{}', '7-A', '2', '119.00', '5', '1', '0', 'true',
     '2024-12-01T10:00:00+02:00');
-- Product 99 was deleted: order item 4 still points at it.

create table raw.product_variants (
    id text, public_id text, product_id text, volume_ml text, price text, stock_quantity text,
    track_stock text, created_at text
);
insert into raw.product_variants values
    ('11', '01900000-0000-7000-8000-000000000011', '1', '5', '119.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('12', '01900000-0000-7000-8000-000000000012', '1', '10', '240.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('13', '01900000-0000-7000-8000-000000000013', '1', '30', '459.00', '5', 'true', '2024-12-01T10:00:00+02:00'),
    ('14', '01900000-0000-7000-8000-000000000014', '1', '50', '629.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('15', '01900000-0000-7000-8000-000000000015', '1', '100', '969.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('21', '01900000-0000-7000-8000-000000000021', '2', '5', '119.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('22', '01900000-0000-7000-8000-000000000022', '2', '10', '240.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('23', '01900000-0000-7000-8000-000000000023', '2', '30', '459.00', '2', 'true', '2024-12-01T10:00:00+02:00'),
    ('24', '01900000-0000-7000-8000-000000000024', '2', '50', '629.00', '0', 'false', '2024-12-01T10:00:00+02:00'),
    ('25', '01900000-0000-7000-8000-000000000025', '2', '100', '969.00', '0', 'false', '2024-12-01T10:00:00+02:00');

create table raw.discounts (
    id text, slug text, code text, kind text, value text, scope_volumes_ml text, min_quantity text,
    max_sets text, starts_at text, ends_at text, max_redemptions text, redemption_count text,
    active text, created_at text
);
insert into raw.discounts values
    ('1', 'tester-trio', null, 'fixed_price_set', '499.00', '{10}', '3', '3', null, null, null, '1',
     'true', '2024-12-01T10:00:00+02:00'),
    ('2', 'welcome-10', 'jassmin10', 'percent', '10.00', null, '1', null, null, null, null, '1',
     'true', '2024-12-01T10:00:00+02:00');

create table raw.sessions (
    session_id text, user_id text, anonymous_id text, started_at text, ended_at text,
    landing_page text, traffic_source text, traffic_medium text, traffic_campaign text,
    device_type text
);
insert into raw.sessions values
    -- s1: Olena signs up and places order 1.
    ('01940000-0000-7000-8000-000000000001', '1', 'anon-olena', '2025-01-05T09:50:00+02:00',
     '2025-01-05T10:10:00+02:00', '/', 'instagram', 'social', null, 'mobile'),
    -- s2: Olena's repeat order 3; device_type missing.
    ('01940000-0000-7000-8000-000000000002', '1', 'anon-olena', '2025-03-10T18:00:00+02:00',
     '2025-03-10T18:20:00+02:00', '/katalog/cholovichi', 'instagram', 'social', null, null),
    -- s3: Ivan signs up and places order 2; one event has a naive UTC timestamp.
    ('01940000-0000-7000-8000-000000000003', '2', 'anon-ivan', '2025-01-10T10:10:00+02:00',
     '2025-01-10T10:45:00+02:00', '/', 'telegram', 'social', 'winter', 'desktop'),
    -- s4: a bot.
    ('01940000-0000-7000-8000-000000000004', null, 'anon-bot', '2025-02-15T03:00:00+02:00',
     '2025-02-15T03:01:00+02:00', '/katalog/zhinochi', 'direct', 'none', null, 'desktop'),
    -- s5: the test account.
    ('01940000-0000-7000-8000-000000000005', '3', 'anon-qa', '2025-02-01T09:00:00+02:00',
     '2025-02-01T09:05:00+02:00', '/', 'direct', 'none', null, 'desktop'),
    -- s6: Maria signs up and places order 4.
    ('01940000-0000-7000-8000-000000000006', '4', 'anon-maria', '2025-03-01T11:40:00+02:00',
     '2025-03-01T12:05:00+02:00', '/', 'direct', 'none', null, 'mobile'),
    -- s7: the guest's first order.
    ('01940000-0000-7000-8000-000000000007', null, 'anon-guest', '2025-02-14T20:00:00+02:00',
     '2025-02-14T20:15:00+02:00', '/akciyi', 'google', 'cpc', 'valentine', 'tablet'),
    -- s8: Ivan's failed card payment.
    ('01940000-0000-7000-8000-000000000008', '2', 'anon-ivan', '2025-02-20T19:00:00+02:00',
     '2025-02-20T19:10:00+02:00', '/', 'telegram', 'social', null, 'desktop'),
    -- s9: Maria's late order 9.
    ('01940000-0000-7000-8000-000000000009', '4', 'anon-maria', '2025-08-30T12:00:00+03:00',
     '2025-08-30T12:10:00+03:00', '/', 'instagram', 'social', null, 'mobile'),
    -- s10: Olena browses without buying, on the last day of data.
    ('01940000-0000-7000-8000-000000000010', '1', 'anon-olena', '2025-08-31T19:00:00+03:00',
     '2025-08-31T19:05:00+03:00', '/', 'instagram', 'social', null, 'mobile'),
    -- s11: the guest's second order.
    ('01940000-0000-7000-8000-000000000011', null, 'anon-guest', '2025-07-20T21:00:00+03:00',
     '2025-07-20T21:10:00+03:00', '/', 'google', 'organic', null, 'mobile');

create table raw.user_events (
    event_id text, user_id text, anonymous_id text, session_id text, event_type text,
    product_id text, event_properties text, source text, medium text, campaign text,
    device_type text, referrer text, created_at text
);
insert into raw.user_events values
    ('01950000-0000-7000-8000-000000000101', null, 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'page_view', null, '{}', 'instagram', 'social', null, 'mobile', null, '2025-01-05T09:50:00+02:00'),
    ('01950000-0000-7000-8000-000000000102', null, 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'product_view', '1', '{"product_public_id": "01900000-0000-7000-8000-000000000001", "variant_id": "01900000-0000-7000-8000-000000000011", "volume_ml": 5, "price": "119.00", "in_stock": true}',
     'instagram', 'social', null, 'mobile', null, '2025-01-05T09:55:00+02:00'),
    -- Double-fired: the same product view 0.4 s later.
    ('01950000-0000-7000-8000-000000000103', null, 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'product_view', '1', '{"product_public_id": "01900000-0000-7000-8000-000000000001", "variant_id": "01900000-0000-7000-8000-000000000011", "volume_ml": 5, "price": "119.00", "in_stock": true}',
     'instagram', 'social', null, 'mobile', null, '2025-01-05T09:55:00.4+02:00'),
    ('01950000-0000-7000-8000-000000000104', '1', 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'login', null, '{"method": "register"}', 'instagram', 'social', null, 'mobile', null, '2025-01-05T10:00:30+02:00'),
    ('01950000-0000-7000-8000-000000000105', '1', 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'add_to_cart', '1', '{"product_public_id": "01900000-0000-7000-8000-000000000001", "variant_id": "01900000-0000-7000-8000-000000000013", "volume_ml": 30, "price": "459.00", "in_stock": true}',
     'instagram', 'social', null, 'mobile', null, '2025-01-05T10:01:00+02:00'),
    ('01950000-0000-7000-8000-000000000106', '1', 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'checkout_start', null, '{}', 'instagram', 'social', null, 'mobile', null, '2025-01-05T10:03:00+02:00'),
    ('01950000-0000-7000-8000-000000000107', '1', 'anon-olena', '01940000-0000-7000-8000-000000000001',
     'purchase', null, '{"order_id": 1}', 'instagram', 'social', null, 'mobile', null, '2025-01-05T10:05:00+02:00'),
    -- s2: device_type missing on the event too.
    ('01950000-0000-7000-8000-000000000201', '1', 'anon-olena', '01940000-0000-7000-8000-000000000002',
     'product_view', '1', '{"product_public_id": "01900000-0000-7000-8000-000000000001", "variant_id": "01900000-0000-7000-8000-000000000013", "volume_ml": 30, "price": "459.00", "in_stock": false}',
     'instagram', 'social', null, null, null, '2025-03-10T18:01:00+02:00'),
    ('01950000-0000-7000-8000-000000000202', '1', 'anon-olena', '01940000-0000-7000-8000-000000000002',
     'purchase', null, '{"order_id": 3}', 'instagram', 'social', null, null, null, '2025-03-10T18:10:00+02:00'),
    -- s3: Ivan. 08:30 naive = 08:30 UTC = 10:30 Kyiv, after his signup at 10:20 Kyiv.
    ('01950000-0000-7000-8000-000000000301', null, 'anon-ivan', '01940000-0000-7000-8000-000000000003',
     'product_view', '2', '{"product_public_id": "01900000-0000-7000-8000-000000000002", "variant_id": "01900000-0000-7000-8000-000000000023", "volume_ml": 30, "price": "459.00", "in_stock": true, "list_id": "catalog", "list_position": 3}',
     'telegram', 'social', 'winter', 'desktop', null, '2025-01-10T10:15:00+02:00'),
    ('01950000-0000-7000-8000-000000000302', '2', 'anon-ivan', '01940000-0000-7000-8000-000000000003',
     'add_to_cart', '2', '{"product_public_id": "01900000-0000-7000-8000-000000000002", "variant_id": "01900000-0000-7000-8000-000000000023", "volume_ml": 30, "price": "459.00", "in_stock": true}',
     'telegram', 'social', 'winter', 'desktop', null, '2025-01-10 08:30:00'),
    ('01950000-0000-7000-8000-000000000303', '2', 'anon-ivan', '01940000-0000-7000-8000-000000000003',
     'purchase', null, '{"order_id": 2}', 'telegram', 'social', 'winter', 'desktop', null, '2025-01-10T10:40:00+02:00'),
    -- s5: the test account.
    ('01950000-0000-7000-8000-000000000501', '3', 'anon-qa', '01940000-0000-7000-8000-000000000005',
     'product_view', '1', '{"product_public_id": "01900000-0000-7000-8000-000000000001", "variant_id": null, "volume_ml": null, "price": null, "in_stock": true}',
     'direct', 'none', null, 'desktop', null, '2025-02-01T09:01:00+02:00'),
    -- s6: Maria.
    ('01950000-0000-7000-8000-000000000601', null, 'anon-maria', '01940000-0000-7000-8000-000000000006',
     'product_view', '2', '{"product_public_id": "01900000-0000-7000-8000-000000000002", "variant_id": "01900000-0000-7000-8000-000000000023", "volume_ml": 30, "price": "459.00", "in_stock": true}',
     'direct', 'none', null, 'mobile', null, '2025-03-01T11:45:00+02:00'),
    ('01950000-0000-7000-8000-000000000602', '4', 'anon-maria', '01940000-0000-7000-8000-000000000006',
     'purchase', null, '{"order_id": 4}', 'direct', 'none', null, 'mobile', null, '2025-03-01T12:00:00+02:00'),
    -- s7: the guest.
    ('01950000-0000-7000-8000-000000000701', null, 'anon-guest', '01940000-0000-7000-8000-000000000007',
     'product_view', '2', '{"product_public_id": "01900000-0000-7000-8000-000000000002", "variant_id": "01900000-0000-7000-8000-000000000022", "volume_ml": 10, "price": "240.00", "in_stock": true}',
     'google', 'cpc', 'valentine', 'tablet', null, '2025-02-14T20:02:00+02:00'),
    ('01950000-0000-7000-8000-000000000702', null, 'anon-guest', '01940000-0000-7000-8000-000000000007',
     'purchase', null, '{"order_id": 5}', 'google', 'cpc', 'valentine', 'tablet', null, '2025-02-14T20:10:00+02:00'),
    -- s8, s9, s10, s11.
    ('01950000-0000-7000-8000-000000000801', '2', 'anon-ivan', '01940000-0000-7000-8000-000000000008',
     'checkout_start', null, '{}', 'telegram', 'social', null, 'desktop', null, '2025-02-20T19:05:00+02:00'),
    ('01950000-0000-7000-8000-000000000901', '4', 'anon-maria', '01940000-0000-7000-8000-000000000009',
     'purchase', null, '{"order_id": 9}', 'instagram', 'social', null, 'mobile', null, '2025-08-30T12:05:00+03:00'),
    ('01950000-0000-7000-8000-000000001001', '1', 'anon-olena', '01940000-0000-7000-8000-000000000010',
     'product_view', '2', '{"product_public_id": "01900000-0000-7000-8000-000000000002", "variant_id": "01900000-0000-7000-8000-000000000021", "volume_ml": 5, "price": "119.00", "in_stock": true}',
     'instagram', 'social', null, 'mobile', null, '2025-08-31T19:01:00+03:00'),
    ('01950000-0000-7000-8000-000000001101', null, 'anon-guest', '01940000-0000-7000-8000-000000000011',
     'purchase', null, '{"order_id": 6}', 'google', 'organic', null, 'mobile', null, '2025-07-20T21:05:00+03:00');

-- s4: the bot, 80 product views 0.7 s apart.
insert into raw.user_events
select
    '01960000-0000-7000-8000-' || lpad(n::text, 12, '0'),
    null, 'anon-bot', '01940000-0000-7000-8000-000000000004', 'product_view',
    (1 + n % 2)::text,
    '{"product_public_id": "01900000-0000-7000-8000-00000000000' || (1 + n % 2)::text || '", "variant_id": null, "volume_ml": null, "price": null, "in_stock": true}',
    'direct', 'none', null, 'desktop', null,
    to_char(
        (timestamptz '2025-02-15T03:00:00+02:00' + n * interval '700 milliseconds')
            at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
    )
from generate_series(1, 80) as n;

create table raw.carts (
    id text, user_id text, session_id text, status text, created_at text, updated_at text,
    abandoned_at text, discount_id text, gift_card_id text, reminder_sent_at text, restored_at text
);
insert into raw.carts values
    ('1', '1', '01940000-0000-7000-8000-000000000001', 'converted', '2025-01-05T10:01:00+02:00', '2025-01-05T10:05:00+02:00', null, null, null, null, null),
    ('2', '2', '01940000-0000-7000-8000-000000000003', 'converted', '2025-01-10T10:30:00+02:00', '2025-01-10T10:40:00+02:00', null, null, null, null, null),
    ('3', '1', '01940000-0000-7000-8000-000000000002', 'converted', '2025-03-10T18:02:00+02:00', '2025-03-10T18:10:00+02:00', null, '2', null, null, null),
    ('4', '4', '01940000-0000-7000-8000-000000000006', 'converted', '2025-03-01T11:46:00+02:00', '2025-03-01T12:00:00+02:00', null, null, null, null, null),
    ('5', null, '01940000-0000-7000-8000-000000000007', 'converted', '2025-02-14T20:03:00+02:00', '2025-02-14T20:10:00+02:00', null, null, null, null, null),
    ('6', null, '01940000-0000-7000-8000-000000000011', 'converted', '2025-07-20T21:02:00+03:00', '2025-07-20T21:05:00+03:00', null, null, null, null, null),
    ('7', '3', '01940000-0000-7000-8000-000000000005', 'converted', '2025-02-01T09:02:00+02:00', '2025-02-01T09:04:00+02:00', null, null, null, null, null),
    ('8', '2', '01940000-0000-7000-8000-000000000008', 'converted', '2025-02-20T19:01:00+02:00', '2025-02-20T19:06:00+02:00', null, null, null, null, null),
    ('9', '4', '01940000-0000-7000-8000-000000000009', 'converted', '2025-08-30T12:01:00+03:00', '2025-08-30T12:05:00+03:00', null, null, null, null, null),
    ('10', '4', null, 'abandoned', '2025-04-01T20:00:00+03:00', '2025-04-01T20:05:00+03:00', '2025-04-02T20:05:00+03:00', null, null, '2025-04-02T21:00:00+03:00', null);

create table raw.cart_items (
    id text, cart_id text, product_id text, variant_id text, quantity text, added_at text
);
insert into raw.cart_items values
    ('1', '1', '1', '13', '1', '2025-01-05T10:01:00+02:00'),
    ('2', '10', '2', '24', '1', '2025-04-01T20:00:00+03:00');

create table raw.orders (
    id text, user_id text, guest_full_name text, guest_email text, guest_phone text,
    shipping_address text, cart_id text, free_shipping text, status text, payment_status text,
    payment_method text, subtotal text, discount_amount text, shipping_amount text,
    gift_card_amount text, total_amount text, currency text, created_at text, updated_at text,
    paid_at text, cancelled_at text, refunded_at text, shipped_at text, completed_at text,
    arrived_at text, waybill_number text, discount_id text, returned_at text, cancel_reason text
);
insert into raw.orders values
    -- 1: ordinary card order, completed.
    ('1', '1', 'Олена Коваль', 'olena@gmail.com', '+380501112233', 'Київ, відділення 12', '1', 'false',
     'completed', 'paid', 'card', '699.00', '0.00', '0.00', '0.00', '699.00', 'UAH',
     '2025-01-05T10:05:00+02:00', null, '2025-01-05T10:06:00+02:00', null, null,
     '2025-01-06T12:00:00+02:00', '2025-01-09T15:00:00+02:00', '2025-01-08T09:00:00+02:00',
     '20450000000001', null, null, null),
    -- 2: x10 price typo, lowercase `uah`, shipped after completion, a deleted product. COD.
    ('2', '2', 'Іван Петренко', ' Ivan.Petrenko@Gmail.com', '+380931112233', 'Львів, відділення 3', '2', 'false',
     'completed', 'paid', 'cod', '1088.00', '0.00', '0.00', '0.00', '10880.00', 'uah',
     '2025-01-10T10:40:00+02:00', null, '2025-01-13T16:00:00+02:00', null, null,
     '2025-01-15T12:00:00+02:00', '2025-01-13T16:00:00+02:00', '2025-01-12T10:00:00+02:00',
     '20450000000002', null, null, null),
    -- 3: welcome code, returned.
    ('3', '1', 'Олена Коваль', 'olena@gmail.com', '+380501112233', 'Київ, відділення 12', '3', 'false',
     'returned', 'refunded', 'card', '697.00', '69.70', '0.00', '0.00', '627.30', 'UAH',
     '2025-03-10T18:10:00+02:00', null, '2025-03-10T18:11:00+02:00', null, '2025-03-21T10:00:00+02:00',
     '2025-03-11T12:00:00+02:00', null, '2025-03-13T09:00:00+02:00',
     '20450000000003', '2', '2025-03-20T10:00:00+02:00', null),
    -- 4: a COD parcel never collected.
    ('4', '4', 'Марія Шевчук', 'maria@ukr.net', '+380671234567', 'Одеса, відділення 5', '4', 'false',
     'unclaimed', 'unpaid', 'cod', '459.00', '0.00', '0.00', '0.00', '459.00', 'UAH',
     '2025-03-01T12:00:00+02:00', null, null, null, null,
     '2025-03-02T12:00:00+02:00', null, '2025-03-04T09:00:00+02:00',
     '20450000000004', null, '2025-03-15T10:00:00+02:00', null),
    -- 5: a guest's tester trio, completed.
    ('5', null, 'Гість Покупець', 'Guest.Buyer@ukr.net ', '+380991112233', 'Харків, відділення 1', '5', 'false',
     'completed', 'paid', 'card', '720.00', '221.00', '0.00', '0.00', '499.00', 'UAH',
     '2025-02-14T20:10:00+02:00', null, '2025-02-14T20:11:00+02:00', null, null,
     '2025-02-15T12:00:00+02:00', '2025-02-18T15:00:00+02:00', '2025-02-17T09:00:00+02:00',
     '20450000000005', '1', null, null),
    -- 6: the same guest again (email written differently), completed.
    ('6', null, 'Гість Покупець', 'guest.buyer@ukr.net', '+380991112233', 'Харків, відділення 1', '6', 'false',
     'completed', 'paid', 'card', '629.00', '0.00', '0.00', '0.00', '629.00', 'UAH',
     '2025-07-20T21:05:00+03:00', null, '2025-07-20T21:06:00+03:00', null, null,
     '2025-07-21T12:00:00+03:00', '2025-07-25T15:00:00+03:00', '2025-07-23T09:00:00+03:00',
     '20450000000006', null, null, null),
    -- 7: the test account's order.
    ('7', '3', 'QA Tester', 'qa1@example.com', '+380000000000', 'Київ, відділення 1', '7', 'false',
     'completed', 'paid', 'card', '240.00', '0.00', '0.00', '0.00', '240.00', 'UAH',
     '2025-02-01T09:04:00+02:00', null, '2025-02-01T09:05:00+02:00', null, null,
     '2025-02-02T12:00:00+02:00', '2025-02-04T15:00:00+02:00', null, null, null, null, null),
    -- 8: a card payment that never succeeded, cancelled by the job.
    ('8', '2', 'Іван Петренко', 'ivan.petrenko@gmail.com', '+380931112233', 'Львів, відділення 3', '8', 'false',
     'cancelled', 'unpaid', 'card', '969.00', '0.00', '0.00', '0.00', '969.00', 'UAH',
     '2025-02-20T19:06:00+02:00', null, null, '2025-02-22T19:06:00+02:00', null,
     null, null, null, null, null, null, 'payment_failed'),
    -- 9: Maria's late order, paid, not shipped yet when the data ends.
    ('9', '4', 'Марія Шевчук', 'maria@ukr.net', '+380671234567', 'Одеса, відділення 5', '9', 'false',
     'paid', 'paid', 'card', '119.00', '0.00', '0.00', '0.00', '119.00', 'UAH',
     '2025-08-30T12:05:00+03:00', null, '2025-08-30T12:06:00+03:00', null, null,
     null, null, null, null, null, null, null);

create table raw.order_items (
    id text, order_id text, product_id text, variant_id text, volume_ml text, quantity text,
    price_at_purchase text, discount_allocated text
);
insert into raw.order_items values
    ('1', '1', '1', '13', '30', '1', '459.00', '0.00'),
    ('2', '1', '1', '12', '10', '1', '240.00', '0.00'),
    ('3', '2', '2', '23', '30', '1', '459.00', '0.00'),
    -- The deleted product: product_id null (#131), variant gone too.
    ('4', '2', null, null, '50', '1', '629.00', '0.00'),
    ('5', '3', '1', '13', '30', '1', '459.00', '45.90'),
    ('6', '3', '1', '11', '5', '2', '119.00', '23.80'),
    ('7', '4', '2', '23', '30', '1', '459.00', '0.00'),
    ('8', '5', '2', '22', '10', '3', '240.00', '221.00'),
    -- The deleted product as #131 writes it: product_id null, the size still there (recoverable).
    ('9', '6', null, '14', '50', '1', '629.00', '0.00'),
    ('10', '7', '1', '12', '10', '1', '240.00', '0.00'),
    ('11', '8', '1', '15', '100', '1', '969.00', '0.00'),
    ('12', '9', '2', '21', '5', '1', '119.00', '0.00');

create table raw.payments (
    id text, order_id text, gift_card_id text, provider text, reference text, status text,
    amount text, currency text, provider_payment_id text, last_callback text, created_at text,
    updated_at text, completed_at text
);
insert into raw.payments values
    ('1', '1', null, 'simulator', '1-1', 'succeeded', '699.00', 'UAH', 'p1', null, '2025-01-05T10:05:00+02:00', null, '2025-01-05T10:06:00+02:00'),
    ('2', '3', null, 'simulator', '3-1', 'succeeded', '627.30', 'UAH', 'p2', null, '2025-03-10T18:10:00+02:00', null, '2025-03-10T18:11:00+02:00'),
    ('3', '5', null, 'simulator', '5-1', 'succeeded', '499.00', 'UAH', 'p3', null, '2025-02-14T20:10:00+02:00', null, '2025-02-14T20:11:00+02:00'),
    ('4', '6', null, 'simulator', '6-1', 'succeeded', '629.00', 'UAH', 'p4', null, '2025-07-20T21:05:00+03:00', null, '2025-07-20T21:06:00+03:00'),
    ('5', '7', null, 'simulator', '7-1', 'succeeded', '240.00', 'UAH', 'p5', null, '2025-02-01T09:04:00+02:00', null, '2025-02-01T09:05:00+02:00'),
    ('6', '8', null, 'simulator', '8-1', 'failed', '969.00', 'uah', 'p6', null, '2025-02-20T19:06:00+02:00', null, '2025-02-20T19:07:00+02:00'),
    ('7', '8', null, 'simulator', '8-2', 'failed', '969.00', 'UAH', 'p7', null, '2025-02-20T19:08:00+02:00', null, '2025-02-20T19:09:00+02:00'),
    ('8', '9', null, 'simulator', '9-1', 'succeeded', '119.00', 'UAH', 'p8', null, '2025-08-30T12:05:00+03:00', null, '2025-08-30T12:06:00+03:00');

create table raw.order_status_history (
    id text, order_id text, status text, changed_at text, source text
);
insert into raw.order_status_history values
    ('1', '1', 'pending', '2025-01-05T10:05:00+02:00', 'checkout'),
    ('2', '1', 'paid', '2025-01-05T10:06:00+02:00', 'payment'),
    ('3', '1', 'shipped', '2025-01-06T12:00:00+02:00', 'cms'),
    ('4', '1', 'completed', '2025-01-09T15:00:00+02:00', 'cms'),
    ('5', '2', 'pending', '2025-01-10T10:40:00+02:00', 'checkout'),
    ('6', '2', 'shipped', '2025-01-11T12:00:00+02:00', 'cms'),
    ('7', '2', 'completed', '2025-01-13T16:00:00+02:00', 'cms'),
    ('8', '3', 'pending', '2025-03-10T18:10:00+02:00', 'checkout'),
    ('9', '3', 'paid', '2025-03-10T18:11:00+02:00', 'payment'),
    ('10', '3', 'shipped', '2025-03-11T12:00:00+02:00', 'cms'),
    ('11', '3', 'returned', '2025-03-20T10:00:00+02:00', 'cms'),
    ('12', '4', 'pending', '2025-03-01T12:00:00+02:00', 'checkout'),
    ('13', '4', 'shipped', '2025-03-02T12:00:00+02:00', 'cms'),
    ('14', '4', 'unclaimed', '2025-03-15T10:00:00+02:00', 'cms'),
    ('15', '5', 'pending', '2025-02-14T20:10:00+02:00', 'checkout'),
    ('16', '5', 'paid', '2025-02-14T20:11:00+02:00', 'payment'),
    ('17', '5', 'shipped', '2025-02-15T12:00:00+02:00', 'cms'),
    ('18', '5', 'completed', '2025-02-18T15:00:00+02:00', 'cms'),
    ('19', '6', 'pending', '2025-07-20T21:05:00+03:00', 'checkout'),
    ('20', '6', 'paid', '2025-07-20T21:06:00+03:00', 'payment'),
    ('21', '6', 'shipped', '2025-07-21T12:00:00+03:00', 'cms'),
    ('22', '6', 'completed', '2025-07-25T15:00:00+03:00', 'cms'),
    ('23', '7', 'pending', '2025-02-01T09:04:00+02:00', 'checkout'),
    ('24', '7', 'completed', '2025-02-04T15:00:00+02:00', 'cms'),
    ('25', '8', 'pending', '2025-02-20T19:06:00+02:00', 'checkout'),
    ('26', '8', 'cancelled', '2025-02-22T19:06:00+02:00', 'job'),
    ('27', '9', 'pending', '2025-08-30T12:05:00+03:00', 'checkout'),
    ('28', '9', 'paid', '2025-08-30T12:06:00+03:00', 'payment');

create table raw.inventory_movements (
    id text, variant_id text, occurred_at text, reason text, quantity_delta text, stock_after text,
    order_id text, source text, note text
);
insert into raw.inventory_movements values
    -- Variant 13 (Sauvage 30 ml): goes to -1 (a backorder) before a receipt.
    ('1', '13', '2025-01-01T00:00:00+02:00', 'opening_balance', '2', '2', null, 'migration', null),
    ('2', '13', '2025-01-05T10:05:00+02:00', 'sale', '-1', '1', '1', 'checkout', null),
    ('3', '13', '2025-02-10T10:00:00+02:00', 'sale', '-1', '0', null, 'checkout', null),
    ('4', '13', '2025-03-10T18:10:00+02:00', 'sale', '-1', '-1', '3', 'checkout', null),
    ('5', '13', '2025-03-12T09:00:00+02:00', 'receipt', '5', '4', null, 'cms', null),
    ('6', '13', '2025-03-20T10:00:00+02:00', 'return', '1', '5', '3', 'cms', null),
    -- Variant 23 (J'adore 30 ml).
    ('7', '23', '2025-01-01T00:00:00+02:00', 'opening_balance', '3', '3', null, 'migration', null),
    ('8', '23', '2025-01-10T10:40:00+02:00', 'sale', '-1', '2', '2', 'checkout', null),
    ('9', '23', '2025-03-01T12:00:00+02:00', 'sale', '-1', '1', '4', 'checkout', null),
    ('10', '23', '2025-03-15T10:00:00+02:00', 'return', '1', '2', '4', 'cms', null);

create table raw.customer_truth (
    user_id text, segment text, purchase_rate text, churn_probability text, favourite_family text,
    usual_device text, churned_at text
);
insert into raw.customer_truth values
    ('1', 'regular', '0.4', '0.2', 'свіжі', 'mobile', null),
    ('2', 'occasional', '0.2', '0.4', 'квіткові', 'desktop', '2025-02-22T00:00:00+02:00'),
    ('4', 'regular', '0.4', '0.2', 'квіткові', 'mobile', null);

-- Match the generator's exact column lists (analytics/generator/frames.py COLUMNS, #131): the rows
-- above were written against the app's tables, which have a few columns the raw layer leaves out.
alter table raw.users drop column password_changed_at;
alter table raw.products drop column notes, add column updated_at text;
alter table raw.discounts add column scope_product_public_ids text, add column scope_pack_size text,
    add column updated_at text;
alter table raw.carts drop column gift_card_id;
alter table raw.payments drop column gift_card_id, drop column provider_payment_id,
    drop column last_callback;
alter table raw.customer_truth add column acquisition_channel text;
