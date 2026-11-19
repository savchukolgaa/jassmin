/**
 * Calls the Jassmin app's `/cms/*` sync routes (#40) from the document middleware, and turns
 * their refusals into the messages staff see in the Strapi admin. The app (PostgreSQL) is the
 * system of record: a product or order edit is saved in Strapi only after the app accepted it.
 *
 * `JASSMIN_APP_URL` is where the app runs (Aspire sets it) and `CMS_SYNC_SECRET` must equal the
 * app's. Messages are in Ukrainian for the shop's staff, with the app's error code at the end.
 */

/** How long staff wait for the app before the save fails. */
export const APP_SYNC_TIMEOUT_MS = 10_000;

/** A refusal or failure to show in the admin; the middleware rethrows it as an `ApplicationError`. */
export class AppSyncError extends Error {
  override readonly name = "AppSyncError";
}

type ErrorBody = { error?: unknown; [key: string]: unknown };

const STATUS_LABELS: Record<string, string> = {
  pending: "Нове",
  paid: "Оплачене",
  shipped: "Відправлене",
  completed: "Виконане",
  cancelled: "Скасоване",
  returned: "Повернене",
  unclaimed: "Не забране",
  unpaid: "Не оплачено",
  refunded: "Кошти повернено",
};

const label = (value: unknown): string => {
  const key = String(value);
  return STATUS_LABELS[key] ? `«${STATUS_LABELS[key]}» (${key})` : `«${key}»`;
};

/** An ISO time as Kyiv time for staff, e.g. «26.11.2026, 12:00»; the value itself when it isn't one. */
function formatKyivTime(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** The admin message for an app answer that isn't 200. */
export function describeAppSyncError(status: number, body: unknown): string {
  const data: ErrorBody = typeof body === "object" && body !== null ? (body as ErrorBody) : {};
  const code = typeof data.error === "string" ? data.error : `http-${status}`;
  const withCode = (message: string) => `${message} [${code}]`;

  switch (code) {
    case "invalid-input": {
      const issues = Array.isArray(data.issues) ? data.issues : [];
      const fields = issues
        .map((issue) =>
          typeof issue === "object" && issue !== null && "path" in issue ? String(issue.path) : "",
        )
        .filter(Boolean);
      const slugHint = fields.includes("slug")
        ? " Slug — латинські літери, цифри та «-», «.», «_», «~», і не у вигляді UUID."
        : "";
      const descriptionHint = fields.some((field) => field.startsWith("description"))
        ? " Опис — до 5000 символів."
        : "";
      if (fields.includes("waybillNumber")) {
        // An order's fields (#138): the product rules below don't apply.
        return withCode("Номер ТТН Нової пошти — 14 цифр (пробіли можна), або порожнє поле.");
      }
      return withCode(
        `Магазин не прийняв дані. Перевірте поля: ${fields.join(", ") || "—"}. ` +
          "Об’єм — 7, 10, 30, 50 або 100 мл, кожен лише раз; ціна більша за 0; залишок не від’ємний. " +
          "Парфум має хоча б одне сімейство аромату, кожне лише раз; нота — до 100 символів." +
          slugHint +
          descriptionHint,
      );
    }
    case "invalid-newsletter": {
      // A newsletter's fields (#181).
      const issues = Array.isArray(data.issues) ? data.issues : [];
      const fields = issues
        .map((issue) =>
          typeof issue === "object" && issue !== null && "path" in issue ? String(issue.path) : "",
        )
        .filter(Boolean);
      if (fields.some((field) => field.startsWith("productPublicIds"))) {
        return withCode("У розсилці може бути щонайбільше 4 різні товари.");
      }
      return withCode(
        `Перевірте поля розсилки: ${fields.join(", ") || "—"}. Тема — до 150 символів, прехедер — до 200, текст обов’язковий; ` +
          "для англійської версії потрібні і тема, і текст. Slug — латинські літери, цифри й дефіси, до 80 символів.",
      );
    }
    case "unknown-product":
      return withCode("Цього товару немає в базі магазину.");
    case "unknown-order":
      return withCode("Цього замовлення немає в базі магазину.");
    case "slug-taken":
      return withCode(`Slug «${String(data.slug)}» уже має інший товар.`);
    case "invalid-transition":
      return withCode(`Не можна змінити статус ${label(data.from)} на ${label(data.to)}.`);
    case "card-not-paid":
      return withCode("Замовлення з оплатою карткою можна відправити лише після оплати.");
    case "cancel-reason-required":
      return withCode("Щоб скасувати замовлення, виберіть «Причину скасування».");
    case "invalid-payment-transition":
      return withCode(`Не можна змінити статус оплати ${label(data.from)} на ${label(data.to)}.`);
    case "arrived-not-shipped":
      return withCode(
        `«Прибуло у відділення» можна позначити лише для відправленого замовлення (зараз ${label(data.status)}).`,
      );
    case "receipt-not-positive":
      return withCode(
        `Надходження має збільшити залишок (розмір ${String(data.volumeMl)} мл). Щоб зменшити залишок, виберіть «коригування».`,
      );
    case "size-has-stock-history":
      return withCode(
        `Розмір ${String(data.volumeMl)} мл уже має історію складу, тому його не можна видалити. Вимкніть «Track stock» або поставте залишок 0.`,
      );
    case "already-sent":
      return withCode("Цю розсилку вже надіслано. Щоб надіслати схожу, дублюйте її.");
    case "newsletter-slug-taken":
      return withCode(
        `Slug «${String(data.slug)}» уже мала інша розсилка. Дайте цій свій slug: за ним рахуємо відвідування з листа.`,
      );
    case "another-sending":
      return withCode(
        "Попередня розсилка ще надсилається. Нову можна надіслати, коли вона завершиться і мине тиждень.",
      );
    case "too-soon":
      return withCode(
        `Ми обіцяємо клієнтам щонайбільше один лист на тиждень. Наступну розсилку можна надіслати з ${formatKyivTime(data.nextAllowedAt)}.`,
      );
    case "no-recipients":
      return withCode(
        "Немає кому надсилати: жоден клієнт із підтвердженою адресою не погодився отримувати новинки.",
      );
    case "mail-not-configured":
      return withCode(
        `Магазин не налаштований для розсилок (бракує ${Array.isArray(data.missing) ? data.missing.join(", ") : "налаштувань"}). Див. docs/email.md.`,
      );
    case "mail-failed":
      return withCode("Не вдалося надіслати тестовий лист. Спробуйте пізніше.");
    case "test-suppressed":
      return withCode(
        "Ваша адреса в списку заблокованих (лист раніше повернувся або позначений як спам), тому тест не надіслано.",
      );
    case "unknown-newsletter":
      return withCode("Магазин не розпізнав цю розсилку.");
    case "unauthorized":
    case "not-configured":
      return withCode(
        "Магазин відхилив запит: CMS_SYNC_SECRET у cms/.env і в .env магазину мають збігатися.",
      );
    default:
      return withCode(`Магазин відповів помилкою ${status}. Зміни не збережено.`);
  }
}

/**
 * POSTs `body` to `<JASSMIN_APP_URL><path>` and returns the app's JSON answer. Throws an
 * `AppSyncError` with the admin message when the app refuses or can't be reached.
 */
export async function postToApp(path: string, body: unknown): Promise<unknown> {
  const appUrl = process.env.JASSMIN_APP_URL;
  const secret = process.env.CMS_SYNC_SECRET;
  if (!appUrl || !secret) {
    throw new AppSyncError(
      "Не налаштовано зв’язок із магазином: задайте JASSMIN_APP_URL і CMS_SYNC_SECRET у cms/.env.",
    );
  }

  let response: Response;
  try {
    response = await fetch(new URL(path, appUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(APP_SYNC_TIMEOUT_MS),
    });
  } catch {
    throw new AppSyncError(
      `Не вдалося зв’язатися з магазином (${appUrl}). Зміни не збережено; спробуйте пізніше.`,
    );
  }

  const answer: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new AppSyncError(describeAppSyncError(response.status, answer));
  }
  return answer;
}
