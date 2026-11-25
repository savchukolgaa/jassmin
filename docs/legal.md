# Legal pages: public offer, delivery and payment, returns

The shop sells online to consumers in Ukraine, so it publishes three legal pages next to the
privacy policy (#18), in Ukrainian and English (#190). Payment providers (LiqPay, WayForPay,
Monobank) also check that these pages exist before they connect a shop.

| Page | Ukrainian URL | English URL | Version date |
|------|---------------|-------------|--------------|
| Public offer (публічна оферта) | `/oferta` | `/en/offer-terms` | `OFFER_UPDATED_AT` |
| Delivery and payment | `/dostavka-i-oplata` | `/en/delivery-and-payment` | `DELIVERY_UPDATED_AT` |
| Returns and exchanges | `/povernennia` | `/en/returns` | `RETURNS_UPDATED_AT` |
| Privacy and cookies | `/konfidentsiinist` | `/en/privacy` | `PRIVACY_POLICY_UPDATED_AT` |

The pages are linked from the footer's second row, under the checkout button ("Оформлюючи
замовлення, ви погоджуєтеся з умовами публічної оферти") and the gift-card "Pay" button, and from
the footer of the order confirmation and gift-card emails. They're listed in `/sitemap.xml` with
hreflang alternates, dated by their version.

> **The text is a careful draft, not legal advice.** The owner, or a lawyer, must review it before
> launch, as for the privacy policy. The pages themselves don't say so.

## Contents

1. [What each page says](#what-each-page-says)
2. [The seller's details](#the-sellers-details)
3. [Accepting the offer](#accepting-the-offer)
4. [Before launch: the owner's checklist](#before-launch-the-owners-checklist)
5. [Changing the text](#changing-the-text)

## What each page says

**Public offer** (`app/features/legal/OfferTerms.tsx`). The contract of sale, a public contract
under the Civil Code of Ukraine, arts. 633 (public contract) and 641 (offer), and an
electronic contract under the Law "On Electronic Commerce". Sections:

1. Parties, with the seller's details from Strapi.
2. Subject of the contract.
3. Placing an order: clicking "Підтвердити замовлення" accepts the offer.
4. Prices and payment: hryvnias; cash on delivery, by card where offered, gift cards.
5. Delivery: Nova Poshta, free from `FREE_SHIPPING_THRESHOLD`; links to delivery and payment.
6. Transfer of ownership: when the parcel is collected.
7. Returns: links to the returns page.
8. Gift cards and discounts: the amounts (`GIFT_CARD_AMOUNTS`) and validity
   (`GIFT_CARD_VALIDITY_MONTHS`); one discount per order, the best one (the trio and couple offer
   are discount rules in the database, so the page links to the offers page instead of quoting
   them).
9. Personal data: links to the privacy policy (Law "On Personal Data Protection").
10. Liability and disputes: negotiation, then Держпродспоживслужба or a court.
11. The seller's details again.

**Delivery and payment** (`DeliveryAndPayment.tsx`). Nova Poshta to a branch or parcel locker
chosen at checkout (#136), tracked by the waybill number (ТТН) emailed when the parcel ships (#137,
#138). Delivery is free from `FREE_SHIPPING_THRESHOLD`; below it the recipient pays Nova Poshta's
rate on collection (the shop charges no delivery itself: `SHIPPING_AMOUNT` is 0). Payment: cash on
delivery, gift cards, and by card only while a payment provider is configured (`PAYMENT_PROVIDER`,
#44). The parcel can be inspected and refused at the branch.

**Returns and exchanges** (`Returns.tsx`). Under the Law "On Consumer Rights Protection":

- Perfume and cosmetics of proper quality are on the Cabinet of Ministers' list of goods that can't
  be returned or exchanged (resolution No. 172 of 19.03.1994), so opened or unsealed products of
  proper quality aren't taken back.
- Defective, damaged or wrong items are replaced or refunded.
- The customer reports it within `RETURN_REPORT_DAYS` (14) days of receipt, with a photo, by the
  email or phone from Strapi; the shop pays the return shipping then.
- A parcel can be refused at the Nova Poshta branch before paying.

Every price, threshold, amount and deadline is formatted from the code constants
(`app/lib/checkout.ts`, `app/lib/gift-cards.ts`, `app/lib/legal.ts`), never typed into the copy, so
the pages stay right when they change.

## The seller's details

They live in Strapi, **Content Manager → Site settings**, so they're edited without a code change:

| Field | Localized | Required | Shown as |
|-------|-----------|----------|----------|
| `legalName` | no | yes | "ФОП <name>" |
| `taxId` | no | yes | РНОКПП, exactly 10 digits |
| `legalAddress` | yes | yes | the registration address |
| `registrationNote` | yes | no | e.g. "Запис в ЄДР № … від …" |
| `phone`, `email` | no | yes (in Strapi) | contacts |

Fill the address and note in Ukrainian; an English translation is optional, and the English page
shows the Ukrainian text until there is one (`getSellerDetails`, `app/.server/legal.ts`).

When a required detail is empty:

- **in development**, the offer shows a highlighted "⚠ not filled in the site settings (Strapi)"
  placeholder in its place;
- **in production**, the line is left out, and the server logs at startup:
  `[legal] Seller details missing in the Strapi site settings: taxId, legalAddress …`. The check
  runs once, in the background, against the Ukrainian settings (the English page falls back to
  them). If Strapi isn't up yet it logs `[legal] Couldn't check …` instead; restart `web` once
  Strapi is running to check again.

When Strapi is down, the pages still render: the offer says the details couldn't be loaded, and the
returns page points to the contacts on the home page.

## Accepting the offer

Placing an order accepts the offer: the line under the checkout button links to it, and there's no
extra checkbox (common Ukrainian practice; it keeps checkout short). Each new order stores the
offer's version date in `orders.offer_version`; orders placed before #190 have `NULL`. Gift-card
purchases show the same line but don't store a version.

## Before launch: the owner's checklist

- [ ] Read all three pages in Ukrainian and English, and have a lawyer review them if possible.
- [ ] Fill in the seller's details in Strapi (name, РНОКПП, address, registration note) in
  Ukrainian and, ideally, English; check the production log has no `[legal]` warning after a
  deploy.
- [ ] Confirm the return rules: no returns of opened products of proper quality, 14 days to report
  a defect with a photo, the shop paying return shipping for defects, refusal at the branch.
- [ ] Confirm the delivery facts: Nova Poshta only, the free-delivery threshold, who pays below it.
- [ ] Confirm the payment methods shown match what's enabled (card payment needs a real provider,
  #44), and check the provider's own requirements for these pages (LiqPay, WayForPay, Monobank).
- [ ] Confirm the gift-card terms (validity, no cash exchange of the balance).
- [ ] Then set `OFFER_UPDATED_AT`, `RETURNS_UPDATED_AT` and `DELIVERY_UPDATED_AT` to the launch
  date.

## Changing the text

1. Edit the copy in `app/lib/i18n/uk.ts` (the source of truth) and `app/lib/i18n/en.ts`, under
   `legal.*`. Add a new paragraph to the page's component in `app/features/legal/`.
2. Set the page's version date in `app/lib/legal.ts` to the day the new text applies. For the
   offer this matters: new orders then store the new `OFFER_UPDATED_AT`, so you can tell which
   version each customer accepted. Keep the old text (git history) for orders placed under it.
3. Update the route tests (`app/routes/offer-terms.test.ts`, `delivery-and-payment.test.ts`,
   `returns.test.ts`) if they quote the changed text, and run `pnpm test`.
