// The promo code field's zod schema (#59). Imported only by route actions, server code and tests,
// so zod stays out of the client bundle (#96).
import { z } from "zod";
import { MAX_PROMO_CODE_LENGTH, normalizePromoCode } from "./discounts";
import { msg } from "./i18n";

export const promoCodeSchema = z
  .string({ error: msg("cart.errors.promoInvalid") })
  .transform(normalizePromoCode)
  .pipe(
    z
      .string()
      .min(1, msg("cart.errors.promoInvalid"))
      .max(MAX_PROMO_CODE_LENGTH, msg("cart.errors.promoInvalid"))
      .regex(/^[A-Z0-9_-]+$/, msg("cart.errors.promoInvalid")),
  );
