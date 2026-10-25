import { describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ getEnv: () => ({ CMS_SYNC_SECRET: undefined }) }));

const SECRET = "s".repeat(32);

function request(authorization?: string): Request {
  return new Request("http://localhost/cms/products", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("checkCmsSyncAuth", () => {
  it("lets the right bearer secret through", async () => {
    const { checkCmsSyncAuth } = await import("./sync-auth");

    expect(checkCmsSyncAuth(request(`Bearer ${SECRET}`), SECRET)).toBeNull();
  });

  it("answers 401 for a missing or wrong secret", async () => {
    const { checkCmsSyncAuth } = await import("./sync-auth");

    expect(checkCmsSyncAuth(request(), SECRET)?.status).toBe(401);
    expect(checkCmsSyncAuth(request("Bearer nope"), SECRET)?.status).toBe(401);
    expect(checkCmsSyncAuth(request(SECRET), SECRET)?.status).toBe(401);
  });

  it("answers 503 when the app has no sync secret", async () => {
    const { checkCmsSyncAuth } = await import("./sync-auth");

    expect(checkCmsSyncAuth(request(`Bearer ${SECRET}`))?.status).toBe(503);
  });
});
