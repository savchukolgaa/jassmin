// The decoded `data` of a LiqPay callback (#192), the fields the shop relies on. LiqPay sends many
// more (card mask, fees, timestamps…); they pass through untouched and are stored on the attempt as
// `last_callback`. Server-only: imported by `liqpay.ts` and its tests.
import { z } from "zod";

/** LiqPay sends numbers (`2450`, `7.34`), but tolerate numeric strings like its own examples. */
const amountSchema = z.union([
  z.number().nonnegative(),
  z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .transform(Number),
]);

export const liqPayCallbackSchema = z.looseObject({
  public_key: z.string().min(1),
  order_id: z.string().min(1),
  status: z.string().min(1),
  amount: amountSchema,
  currency: z.string().min(1),
  payment_id: z.union([z.number(), z.string().min(1)]).optional(),
  action: z.string().optional(),
});

export type LiqPayCallback = z.infer<typeof liqPayCallbackSchema>;
