const UAH = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Formats a `numeric(10, 2)` price string (e.g. `"6850.00"`) in hryvnias for display, e.g.
 * `6 850 ₴`. Display only: never do arithmetic on the result or on the parsed number.
 */
export function formatPrice(price: string): string {
  return UAH.format(Number(price));
}
