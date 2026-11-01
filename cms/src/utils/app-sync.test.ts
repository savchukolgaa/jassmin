import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSyncError, describeAppSyncError, postToApp } from "./app-sync";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("describeAppSyncError", () => {
  it("names both statuses of a refused transition", () => {
    expect(
      describeAppSyncError(422, { error: "invalid-transition", from: "cancelled", to: "shipped" }),
    ).toBe(
      "Не можна змінити статус «Скасоване» (cancelled) на «Відправлене» (shipped). [invalid-transition]",
    );
  });

  it("lists the fields of invalid input", () => {
    const message = describeAppSyncError(422, {
      error: "invalid-input",
      issues: [{ path: "variants.0.volumeMl", message: "Invalid input" }, { path: "slug" }],
    });

    expect(message).toContain("variants.0.volumeMl, slug");
    expect(message).toContain("не у вигляді UUID");
    expect(message).toMatch(/\[invalid-input\]$/);
  });

  it("explains a secret mismatch and an unexpected status", () => {
    expect(describeAppSyncError(401, { error: "unauthorized" })).toContain("CMS_SYNC_SECRET");
    expect(describeAppSyncError(500, undefined)).toBe(
      "Магазин відповів помилкою 500. Зміни не збережено. [http-500]",
    );
  });
});

describe("postToApp", () => {
  it("posts JSON with the bearer secret and returns the answer", async () => {
    vi.stubEnv("JASSMIN_APP_URL", "http://app.test");
    vi.stubEnv("CMS_SYNC_SECRET", "secret");
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) =>
      Response.json({ orderId: 7 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await postToApp("/cms/orders/7", { status: "shipped" })).toEqual({ orderId: 7 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://app.test/cms/orders/7");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "shipped" });
  });

  it("throws the admin message for a refusal", async () => {
    vi.stubEnv("JASSMIN_APP_URL", "http://app.test");
    vi.stubEnv("CMS_SYNC_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "card-not-paid" }, { status: 422 })),
    );

    await expect(postToApp("/cms/orders/7", {})).rejects.toThrow(
      new AppSyncError(
        "Замовлення з оплатою карткою можна відправити лише після оплати. [card-not-paid]",
      ),
    );
  });

  it("fails clearly when the app is unreachable or not configured", async () => {
    vi.stubEnv("JASSMIN_APP_URL", "http://app.test");
    vi.stubEnv("CMS_SYNC_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(postToApp("/cms/products", {})).rejects.toThrow(/http:\/\/app\.test/);

    vi.stubEnv("CMS_SYNC_SECRET", "");
    await expect(postToApp("/cms/products", {})).rejects.toThrow(/CMS_SYNC_SECRET/);
  });
});
