import { describe, expect, it } from "vitest";
import { describeRouteError } from "./route-error";

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
    });
  });

  it("describes a CMS outage (503)", () => {
    expect(describeRouteError(routeError(503)).message).toBe("503");
  });

  it("uses the status text for other route errors", () => {
    expect(describeRouteError(routeError(403, "Forbidden"))).toEqual({
      message: "Error",
      details: "Forbidden",
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
});
