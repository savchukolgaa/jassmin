import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";
import { describeRouteError as describe_ } from "./route-error";

const { t } = createTranslator("en");
const describeRouteError = (error: unknown, dev?: boolean) => describe_(error, t, dev);

// The shape the router gives a boundary for a thrown `data(…, { status })` response.
const routeError = (status: number, statusText = "") => ({
  status,
  statusText,
  internal: false,
  data: null,
});

describe("describeRouteError", () => {
  it("describes a 404", () => {
    expect(describeRouteError(routeError(404))).toEqual({
      message: "404",
      details: "The requested page could not be found.",
      notFound: true,
    });
  });

  it("describes a CMS outage (503)", () => {
    expect(describeRouteError(routeError(503)).message).toBe("503");
  });

  it("describes a forbidden admin page (403)", () => {
    expect(describeRouteError(routeError(403, "Forbidden"))).toEqual({
      message: "403",
      details: "You don't have access to this page.",
    });
  });

  it("uses the status text for other route errors", () => {
    expect(describeRouteError(routeError(401, "Unauthorized"))).toEqual({
      message: "Error",
      details: "Unauthorized",
    });
  });

  it("shows the message and stack of unexpected errors only in development", () => {
    const error = new Error("boom");

    expect(describeRouteError(error, true)).toMatchObject({ details: "boom", stack: error.stack });
    expect(describeRouteError(error, false)).toEqual({
      message: "Oops!",
      details: "An unexpected error occurred.",
    });
  });

  it("describes errors in Ukrainian", () => {
    const uk = createTranslator("uk");
    expect(describe_(routeError(404), uk.t)).toEqual({
      message: "404",
      details: "Сторінку не знайдено.",
      notFound: true,
    });
    expect(describe_(new Error("boom"), uk.t, false)).toEqual({
      message: "Ой!",
      details: "Сталася неочікувана помилка.",
    });
  });
});
