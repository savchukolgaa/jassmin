// The analytics event contract (#129) and the JSON body the client tracker posts to `/api/events`
// (#18), as zod schemas. Imported only by route loaders/actions, server code and tests, so zod
// stays out of the client bundle (#96).
import { z } from "zod";
import {
  CLIENT_EVENT_TYPES,
  type EventProperties,
  type EventPropertiesMap,
  LIST_IDS,
  MAX_CLIENT_EVENTS,
  MAX_DWELL_MS,
  MAX_SEARCH_RESULT_IDS,
} from "./analytics";
import { CATALOG_GENDERS, CATALOG_SORTS } from "./catalog";
import { type EventType, PAYMENT_METHODS } from "./enums";

/** A same-site path: starts with one `/` (so not `//host`) and has no backslash. */
const sitePath = z
  .string()
  .max(2048)
  .refine((path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"));

/** An exact amount in hryvnias, like the money columns: `"499.00"`. */
const money = z.string().regex(/^\d{1,10}\.\d{2}$/);

const listPosition = z.int().min(1).max(100_000);

/** Short free text from the catalog's filters (brand and family names). */
const label = z.string().max(200);

const productContextShape = {
  product_public_id: z.uuid(),
  variant_id: z.uuid().nullable(),
  volume_ml: z.int().positive().max(10_000).nullable(),
  price: money.nullable(),
  in_stock: z.boolean(),
  list_id: z.enum(LIST_IDS).optional(),
  list_position: listPosition.optional(),
  search_id: z.uuid().optional(),
};

const listedProductShape = {
  ...productContextShape,
  list_id: z.enum(LIST_IDS),
  list_position: listPosition,
};

const cartChangeShape = {
  ...productContextShape,
  quantity: z.int().positive(),
  cart_value_after: money,
  source: z.literal("stepper").optional(),
};

// Strict objects: an unknown key (and so any personal data) fails the event.
export const eventPropertiesSchemas = {
  page_view: z.strictObject({ path: sitePath }),
  product_view: z.strictObject(productContextShape),
  product_impression: z.strictObject(listedProductShape),
  product_click: z.strictObject(listedProductShape),
  product_dwell: z.strictObject({
    ...productContextShape,
    dwell_ms: z.int().min(0).max(MAX_DWELL_MS),
    max_scroll_pct: z.int().min(0).max(100),
  }),
  search: z.strictObject({
    search_id: z.uuid(),
    query: z.string().max(200).nullable(),
    gender: z.enum(CATALOG_GENDERS),
    fragrance_family: label.nullable(),
    brand: label.nullable(),
    sort: z.enum(CATALOG_SORTS),
    page: z.int().min(1),
    result_count: z.int().min(0),
    product_public_ids: z.array(z.uuid()).max(MAX_SEARCH_RESULT_IDS),
  }),
  add_to_cart: z.strictObject(cartChangeShape),
  remove_from_cart: z.strictObject(cartChangeShape),
  checkout_start: z.strictObject({
    subtotal: money,
    item_count: z.int().min(0),
    discount_amount: money,
    discount_code: label.nullable(),
  }),
  purchase: z.strictObject({
    order_id: z.int().positive(),
    subtotal: money,
    total_amount: money,
    discount_amount: money,
    discount_id: z.int().positive().nullable(),
    discount_code: label.nullable(),
    gift_card_amount: money,
    payment_method: z.enum(PAYMENT_METHODS),
    items: z
      .array(
        z.strictObject({
          variant_id: z.uuid(),
          quantity: z.int().positive(),
          unit_price: money,
          discount_allocated: money,
        }),
      )
      .min(1),
    is_first_order: z.boolean(),
  }),
  login: z.strictObject({ method: z.enum(["login", "register", "password_reset"]) }),
  review_submit: z.strictObject({ product_public_id: z.uuid() }),
} satisfies { [T in EventType]: z.ZodType<EventPropertiesMap[T]> };

/** The event's properties if they match its type's contract, else `null`. */
export function parseEventProperties(type: EventType, value: unknown): EventProperties | null {
  const schema: z.ZodType<EventProperties> = eventPropertiesSchemas[type];
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

const envelope = {
  /** The page the event happened on. */
  path: sitePath,
  referrer: sitePath.optional(),
};

/** One event from the client tracker; product events carry their properties. */
const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page_view"), ...envelope }),
  z.object({
    type: z.literal("product_impression"),
    ...envelope,
    properties: eventPropertiesSchemas.product_impression,
  }),
  z.object({
    type: z.literal("product_click"),
    ...envelope,
    properties: eventPropertiesSchemas.product_click,
  }),
  z.object({
    type: z.literal("product_dwell"),
    ...envelope,
    properties: eventPropertiesSchemas.product_dwell,
  }),
]);

/** The JSON body the client tracker posts to `/api/events`. */
export const clientEventBatchSchema = z.object({
  events: z.array(clientEventSchema).min(1).max(MAX_CLIENT_EVENTS),
});

export type ClientEventBatch = z.infer<typeof clientEventBatchSchema>;

export type ClientEvent = ClientEventBatch["events"][number];

// Every client event type has a branch above.
const _clientTypesCovered: ReadonlyArray<ClientEvent["type"]> = CLIENT_EVENT_TYPES;
void _clientTypesCovered;
