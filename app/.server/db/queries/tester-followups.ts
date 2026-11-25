// The tester follow-up (#191): about `TESTER_FOLLOWUP_DAYS` after a tester order is delivered, a
// customer who agreed to marketing email gets one email with the perfumes they tried and a
// personal, single-use code for a percent off a full bottle of them. This module decides who gets
// one, creates the code and queues the `order_emails` row, and reads what the email shows when it
// is sent (`pnpm db:send-tester-followups`, `db/tester-followups.ts`).
//
// It must not import `db/index.ts` (the job runs without the web app's env).
import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import type { OrderStatus } from "~/lib/enums";
import { GIFT_CARD_CODE_ALPHABET } from "~/lib/gift-cards";
import type { Locale } from "~/lib/i18n/locales";
import type { Db } from "../client";
import { discounts, orderEmails } from "../schema";

/** A `Db` or a transaction. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

/** The tester size: a line of this volume on a single-perfume product (`pack_size = 1`). */
export const TESTER_VOLUME_ML = 10;

/** The full-bottle sizes the code takes money off. */
export const FULL_BOTTLE_VOLUMES_ML = [30, 50, 100] as const;

/** Without an arrival or pickup date, an order counts as delivered this long after shipping. */
export const SHIPPED_DELIVERY_DAYS = 3;

/**
 * An order stays due this many days after it first became due, so one held back by the spacing
 * rules goes out later, while launching the job never emails months-old orders.
 */
export const TESTER_FOLLOWUP_WINDOW_DAYS = 14;

/** At most one follow-up per customer in this many days. */
export const TESTER_FOLLOWUP_INTERVAL_DAYS = 30;

/** No follow-up within this many days of a cart reminder (#139) or a newsletter (#181). */
export const MARKETING_GAP_DAYS = 7;

/** How long the personal code is valid. */
export const TESTER_FOLLOWUP_VALID_DAYS = 30;

/** Follow-ups queued per job run at most; the next daily run takes the rest. */
export const TESTER_FOLLOWUP_BATCH_SIZE = 100;

/** The perfumes an email shows at most (a tester trio has three). */
export const TESTER_FOLLOWUP_MAX_PRODUCTS = 6;

/** The discount's slug is this plus the order id; analytics finds the orders it brought by it. */
export const TESTER_FOLLOWUP_SLUG_PREFIX = "tester-followup-";

/** The personal code: this prefix and `TESTER_FOLLOWUP_CODE_LENGTH` symbols. */
export const TESTER_FOLLOWUP_CODE_PREFIX = "TRY-";
export const TESTER_FOLLOWUP_CODE_LENGTH = 8;

/** New codes to try when one is taken; 32⁸ codes make a clash very rare already. */
const CODE_ATTEMPTS = 5;

export function testerFollowupSlug(orderId: number): string {
  return `${TESTER_FOLLOWUP_SLUG_PREFIX}${orderId}`;
}

/** A new random code such as `TRY-7KQ2M9XD` (Crockford's base 32, from the system's CSPRNG). */
export function generateTesterFollowupCode(random: (max: number) => number = randomInt): string {
  let code = TESTER_FOLLOWUP_CODE_PREFIX;
  for (let i = 0; i < TESTER_FOLLOWUP_CODE_LENGTH; i += 1) {
    code += GIFT_CARD_CODE_ALPHABET[random(GIFT_CARD_CODE_ALPHABET.length)];
  }
  return code;
}

const fullVolumes = sql.raw(`array[${FULL_BOTTLE_VOLUMES_ML.join(", ")}]`);

/** Product `p` (aliased) is sold and has a full-bottle size in stock or untracked (#98). */
const fullBottleInStock = sql`p.active and exists (
  select 1 from product_variants fv
  where fv.product_id = p.id
    and fv.volume_ml = any(${fullVolumes})
    and (not fv.track_stock or fv.stock_quantity > 0))`;

/**
 * The tester lines of order `orderAlias.id`: `t.product_id` and `p` (the product) for each,
 * as a `from` clause body.
 */
function testerLines(orderId: ReturnType<typeof sql.raw>) {
  return sql`order_items t
    join products p on p.id = t.product_id
    where t.order_id = ${orderId}
      and t.volume_ml = ${TESTER_VOLUME_ML}
      and p.pack_size = 1`;
}

/**
 * Whether user `userId` placed an order (not cancelled) after `since` with a full bottle of a
 * perfume tried in `orderId`, as SQL.
 */
function boughtBottleSince(
  userId: ReturnType<typeof sql.raw>,
  orderId: ReturnType<typeof sql.raw>,
  since: ReturnType<typeof sql.raw>,
) {
  return sql`exists (
    select 1 from orders b
    join order_items bi on bi.order_id = b.id
    join products bp on bp.id = bi.product_id
    where b.user_id = ${userId}
      and b.created_at > ${since}
      and b.status <> 'cancelled'
      and bi.volume_ml = any(${fullVolumes})
      and bp.pack_size = 1
      and bi.product_id in (select t.product_id from ${testerLines(orderId)}))`;
}

export interface TesterFollowupCandidate {
  orderId: number;
  userId: number;
  locale: Locale;
  /** The tried perfumes still sold with a full bottle in stock, the code's product scope. */
  productPublicIds: string[];
}

export interface TesterFollowupOptions {
  /** `TESTER_FOLLOWUP_DAYS`: days after delivery. */
  days: number;
  now?: Date;
  limit?: number;
}

/**
 * The orders due a follow-up now, at most one per user (their latest due order). Due: a
 * registered customer's `shipped` or `completed` order (never returned) with a tester line,
 * delivered (`completed_at`, else `arrived_at`, else `shipped_at` + `SHIPPED_DELIVERY_DAYS`)
 * between `days + TESTER_FOLLOWUP_WINDOW_DAYS` and `days` ago, without a follow-up yet. The
 * customer agreed to marketing email, verified the address (#135) and isn't suppressed (#134);
 * had no follow-up in `TESTER_FOLLOWUP_INTERVAL_DAYS`, no cart reminder and no newsletter (sent,
 * or still queued) in `MARKETING_GAP_DAYS`; and hasn't ordered a full bottle of any perfume they
 * tried since. At least one tried perfume is still sold with a full size in stock.
 */
export async function findTesterFollowupCandidates(
  db: Pick<Db, "execute">,
  { days, now = new Date(), limit = TESTER_FOLLOWUP_BATCH_SIZE }: TesterFollowupOptions,
): Promise<TesterFollowupCandidate[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const result = await db.execute<{
    order_id: number;
    user_id: number;
    locale: Locale;
    product_public_ids: string[];
  }>(sql`
    with delivered as (
      select o.id, o.user_id, o.created_at,
        coalesce(o.completed_at, o.arrived_at,
          o.shipped_at + make_interval(days => ${SHIPPED_DELIVERY_DAYS})) as delivered_at
      from orders o
      where o.user_id is not null
        and o.status in ('shipped', 'completed')
        and o.returned_at is null
    ),
    candidates as (
      select distinct on (d.user_id) d.id as order_id, d.user_id,
        coalesce(u.locale, 'uk') as locale,
        array(
          select distinct p.public_id from ${testerLines(sql.raw("d.id"))}
            and ${fullBottleInStock}
          order by p.public_id
        ) as product_public_ids
      from delivered d
      join users u on u.id = d.user_id
      where d.delivered_at <= ${at} - make_interval(days => ${days})
        and d.delivered_at > ${at} - make_interval(days => ${days + TESTER_FOLLOWUP_WINDOW_DAYS})
        and u.marketing_opt_in
        and u.email_verified_at is not null
        and not exists (
          select 1 from email_suppressions s where s.address = lower(u.email))
        and exists (select 1 from ${testerLines(sql.raw("d.id"))} and ${fullBottleInStock})
        and not exists (
          select 1 from order_emails e
          where e.order_id = d.id and e.type = 'tester_followup')
        and not exists (
          select 1 from order_emails e
          join orders eo on eo.id = e.order_id
          where eo.user_id = d.user_id
            and e.type = 'tester_followup'
            and e.created_at > ${at} - make_interval(days => ${TESTER_FOLLOWUP_INTERVAL_DAYS}))
        and not exists (
          select 1 from carts c
          where c.user_id = d.user_id
            and c.reminder_sent_at > ${at} - make_interval(days => ${MARKETING_GAP_DAYS}))
        and not exists (
          select 1 from newsletter_deliveries n
          where n.user_id = d.user_id
            and (n.status = 'queued'
              or n.sent_at > ${at} - make_interval(days => ${MARKETING_GAP_DAYS})))
        and not ${boughtBottleSince(sql.raw("d.user_id"), sql.raw("d.id"), sql.raw("d.created_at"))}
      order by d.user_id, d.delivered_at desc, d.id desc
    )
    select order_id, user_id, locale, product_public_ids
    from candidates
    order by order_id
    limit ${limit}`);
  return result.rows.map((row) => ({
    orderId: Number(row.order_id),
    userId: Number(row.user_id),
    locale: row.locale,
    productPublicIds: row.product_public_ids,
  }));
}

export interface QueueTesterFollowupsOptions extends TesterFollowupOptions {
  /** `TESTER_FOLLOWUP_PERCENT`: the percent off a full bottle. */
  percent: number;
  generateCode?: () => string;
}

/** Thrown inside a queuing transaction to roll it back when the order already has a follow-up. */
class AlreadyQueued extends Error {}

/**
 * Creates the personal discount and queues the `tester_followup` email of one candidate, in one
 * transaction. Returns whether this call queued it; `false` when a concurrent run (or an earlier
 * one) already did.
 */
export async function queueTesterFollowup(
  db: Db,
  candidate: TesterFollowupCandidate,
  {
    percent,
    now = new Date(),
    generateCode = generateTesterFollowupCode,
  }: Pick<QueueTesterFollowupsOptions, "percent" | "now" | "generateCode">,
): Promise<boolean> {
  const slug = testerFollowupSlug(candidate.orderId);
  const endsAt = new Date(now.getTime() + TESTER_FOLLOWUP_VALID_DAYS * 24 * 60 * 60 * 1000);
  try {
    return await db.transaction(async (tx) => {
      for (let attempt = 1; ; attempt += 1) {
        const inserted = await tx
          .insert(discounts)
          .values({
            slug,
            code: generateCode(),
            kind: "percent",
            value: percent.toFixed(2),
            scopeProductPublicIds: candidate.productPublicIds,
            scopeVolumesMl: [...FULL_BOTTLE_VOLUMES_ML],
            scopePackSize: 1,
            maxRedemptions: 1,
            startsAt: now,
            endsAt,
          })
          .onConflictDoNothing()
          .returning({ id: discounts.id });
        if (inserted.length > 0) break;
        // The slug is taken: this order has its code already. Otherwise the code clashed.
        const taken = await tx.execute(sql`select 1 from discounts where slug = ${slug}`);
        if (taken.rows.length > 0) throw new AlreadyQueued();
        if (attempt >= CODE_ATTEMPTS) {
          throw new Error(`No free tester follow-up code after ${CODE_ATTEMPTS} attempts`);
        }
      }
      const queued = await tx
        .insert(orderEmails)
        .values({ orderId: candidate.orderId, type: "tester_followup", locale: candidate.locale })
        .onConflictDoNothing()
        .returning({ id: orderEmails.id });
      if (queued.length === 0) throw new AlreadyQueued();
      return true;
    });
  } catch (error) {
    if (error instanceof AlreadyQueued) return false;
    throw error;
  }
}

/** Queues the follow-up of every due order (see `findTesterFollowupCandidates`); the order ids. */
export async function queueTesterFollowups(
  db: Db,
  options: QueueTesterFollowupsOptions,
): Promise<number[]> {
  const candidates = await findTesterFollowupCandidates(db, options);
  const queued: number[] = [];
  for (const candidate of candidates) {
    if (await queueTesterFollowup(db, candidate, options)) {
      queued.push(candidate.orderId);
    }
  }
  return queued;
}

/** A perfume as the email shows it. */
export interface TesterFollowupProduct {
  publicId: string;
  slug: string | null;
  title: string;
  brand: string;
  imageUrl: string | null;
  /** The lowest price of its full sizes in stock, as an exact decimal. */
  fromPrice: string;
}

/** The personal code as the email shows it. */
export interface TesterFollowupDiscount {
  code: string;
  /** The percent off, as an exact decimal (`"10.00"`). */
  percent: string;
  endsAt: Date;
  active: boolean;
  /** Redeemed already (single use). */
  usedUp: boolean;
}

/** What the follow-up email needs, read when it is sent. */
export interface TesterFollowup {
  orderId: number;
  userId: number;
  fullName: string;
  email: string;
  marketingOptIn: boolean;
  emailVerified: boolean;
  orderStatus: OrderStatus;
  returned: boolean;
  /** The customer ordered a full bottle of a tried perfume after the tester order. */
  boughtBottleSince: boolean;
  /** `undefined` when the code is gone. */
  discount: TesterFollowupDiscount | undefined;
  /**
   * The code's perfumes still sold with a full size in stock, by title, at most
   * `TESTER_FOLLOWUP_MAX_PRODUCTS`.
   */
  products: TesterFollowupProduct[];
}

/** The follow-up of a registered customer's order, or `undefined` when there is none. */
export async function findTesterFollowup(
  db: Executor,
  orderId: number,
): Promise<TesterFollowup | undefined> {
  const orders = await db.execute<{
    order_id: number;
    user_id: number;
    full_name: string;
    email: string;
    marketing_opt_in: boolean;
    email_verified: boolean;
    status: OrderStatus;
    returned: boolean;
    bought_bottle_since: boolean;
  }>(sql`
    select o.id as order_id, u.id as user_id, u.full_name, u.email, u.marketing_opt_in,
      u.email_verified_at is not null as email_verified, o.status,
      o.returned_at is not null as returned,
      ${boughtBottleSince(sql.raw("o.user_id"), sql.raw("o.id"), sql.raw("o.created_at"))}
        as bought_bottle_since
    from orders o
    join users u on u.id = o.user_id
    where o.id = ${orderId}`);
  const [order] = orders.rows;
  if (!order) {
    return undefined;
  }
  const discountRows = await db.execute<{
    code: string;
    value: string;
    ends_at: Date | string;
    active: boolean;
    used_up: boolean;
    product_public_ids: string[] | null;
  }>(sql`
    select code, value, ends_at, active,
      max_redemptions is not null and redemption_count >= max_redemptions as used_up,
      scope_product_public_ids as product_public_ids
    from discounts
    where slug = ${testerFollowupSlug(orderId)} and code is not null and ends_at is not null`);
  const [row] = discountRows.rows;
  const products = row?.product_public_ids?.length
    ? await db.execute<{
        public_id: string;
        slug: string | null;
        title: string;
        brand: string;
        image_url: string | null;
        from_price: string;
      }>(sql`
        select p.public_id, p.slug, p.title, p.brand, p.image_url,
          (select min(fv.price) from product_variants fv
            where fv.product_id = p.id
              and fv.volume_ml = any(${fullVolumes})
              and (not fv.track_stock or fv.stock_quantity > 0))::numeric(10, 2) as from_price
        from products p
        where p.public_id = any(${`{${row.product_public_ids.join(",")}}`}::uuid[])
          and ${fullBottleInStock}
        order by p.title, p.id
        limit ${TESTER_FOLLOWUP_MAX_PRODUCTS}`)
    : { rows: [] };
  return {
    orderId: Number(order.order_id),
    userId: Number(order.user_id),
    fullName: order.full_name,
    email: order.email,
    marketingOptIn: order.marketing_opt_in,
    emailVerified: order.email_verified,
    orderStatus: order.status,
    returned: order.returned,
    boughtBottleSince: order.bought_bottle_since,
    discount: row && {
      code: row.code,
      percent: row.value,
      endsAt: new Date(row.ends_at),
      active: row.active,
      usedUp: row.used_up,
    },
    products: products.rows.map((p) => ({
      publicId: p.public_id,
      slug: p.slug,
      title: p.title,
      brand: p.brand,
      imageUrl: p.image_url,
      fromPrice: p.from_price,
    })),
  };
}

/** The order's `tester_followup` outbox row, for tests and the report. */
export async function findTesterFollowupEmail(db: Executor, orderId: number) {
  const rows = await db.execute<{ id: number; locale: Locale; status: string }>(sql`
    select id, locale, status from order_emails
    where order_id = ${orderId} and type = 'tester_followup'`);
  return rows.rows[0];
}
