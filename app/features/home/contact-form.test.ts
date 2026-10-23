import { describe, expect, it } from "vitest";
import { parseContactForm } from "./contact-form";

function form(fields: Record<string, string | Blob>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const valid = { name: "Olha", email: "olha@example.com", message: "Do you have Chanel testers?" };

describe("parseContactForm", () => {
  it("accepts a valid submission and trims the values", () => {
    const result = parseContactForm(form({ ...valid, name: "  Olha  " }));

    expect(result).toEqual({ ok: true, data: valid, honeypot: false });
  });

  it("flags a filled honeypot", () => {
    expect(parseContactForm(form({ ...valid, website: "spam.test" }))).toMatchObject({
      ok: true,
      honeypot: true,
    });
  });

  it("returns one error per invalid field and the submitted values", () => {
    const result = parseContactForm(form({ name: "   ", email: "nope", message: "short" }));

    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: "Please enter your name.",
        email: "Please enter a valid email address.",
        message: "Your message needs at least 10 characters.",
      },
      values: { name: "   ", email: "nope", message: "short" },
    });
  });

  it("asks for an email when it's empty", () => {
    const result = parseContactForm(form({ ...valid, email: "" }));

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { email: "Please enter your email address." },
    });
  });

  it("rejects values over the limits", () => {
    const result = parseContactForm(
      form({ name: "a".repeat(101), email: `${"a".repeat(250)}@x.io`, message: "m".repeat(2001) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["email", "message", "name"]);
  });

  it("treats missing fields and file uploads as empty", () => {
    const result = parseContactForm(form({ name: new Blob(["x"]), message: valid.message }));

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: "Please enter your name.", email: "Please enter your email address." },
      values: { name: "", email: "", message: valid.message },
    });
  });
});
