import { describe, expect, it } from "vitest";
import { checkBearerSecret } from "./bearer-auth";

const SECRET = "s".repeat(32);

function request(authorization?: string): Request {
  return new Request("http://localhost/hooks/email", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("checkBearerSecret", () => {
  it("lets the right bearer secret through", () => {
    expect(checkBearerSecret(request(`Bearer ${SECRET}`), SECRET)).toBeNull();
  });

  it("answers 401 for a missing, wrong or unprefixed secret", async () => {
    for (const authorization of [undefined, "Bearer nope", SECRET, `Basic ${SECRET}`]) {
      const response = checkBearerSecret(request(authorization), SECRET);
      expect(response?.status).toBe(401);
      expect(await response?.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("refuses a secret that only shares a prefix or differs in length", () => {
    expect(checkBearerSecret(request(`Bearer ${SECRET}x`), SECRET)?.status).toBe(401);
    expect(checkBearerSecret(request(`Bearer ${SECRET.slice(1)}`), SECRET)?.status).toBe(401);
  });

  it("answers 503 when no secret is configured", async () => {
    for (const secret of [undefined, ""]) {
      const response = checkBearerSecret(request(`Bearer ${SECRET}`), secret);
      expect(response?.status).toBe(503);
      expect(await response?.json()).toEqual({ error: "not-configured" });
    }
  });
});
