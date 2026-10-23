import { describe, expect, it } from "vitest";
import { smtpOptionsFromUrl } from "./mail";

describe("smtpOptionsFromUrl", () => {
  it("maps a plain smtp URL without credentials (smtp4dev)", () => {
    expect(smtpOptionsFromUrl("smtp://localhost:2525")).toMatchObject({
      host: "localhost",
      port: 2525,
      secure: false,
      auth: undefined,
    });
  });

  it("maps smtps with credentials and the default TLS port", () => {
    expect(smtpOptionsFromUrl("smtps://shop%40example.com:p%40ss@mail.example.com")).toMatchObject({
      host: "mail.example.com",
      port: 465,
      secure: true,
      auth: { user: "shop@example.com", pass: "p@ss" },
    });
  });

  it("defaults smtp to port 25", () => {
    expect(smtpOptionsFromUrl("smtp://mail.example.com").port).toBe(25);
  });
});
