import { describe, expect, it } from "vitest";
import { pageUrl } from "./request-url";

const href = (url: string) => pageUrl(new Request(url)).href;

describe("pageUrl", () => {
  it("is the page of a single-fetch data request (#112)", () => {
    expect(href("http://localhost/en.data")).toBe("http://localhost/en");
    expect(href("http://localhost/_.data")).toBe("http://localhost/");
    expect(href("http://localhost/koshyk.data")).toBe("http://localhost/koshyk");
  });

  it("drops `_routes` and keeps every other param", () => {
    expect(href("http://localhost/en/catalog/women.data?_routes=root%2Ccatalog.en&sort=new")).toBe(
      "http://localhost/en/catalog/women?sort=new",
    );
    expect(href("http://localhost/_.data?index")).toBe("http://localhost/?index");
  });

  it("leaves document requests and paths that only contain `.data` alone", () => {
    expect(href("https://jassmin.ua/en/popular?family=floral")).toBe(
      "https://jassmin.ua/en/popular?family=floral",
    );
    expect(href("http://localhost/blog/a.data-b")).toBe("http://localhost/blog/a.data-b");
  });
});
