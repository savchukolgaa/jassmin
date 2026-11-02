import { describe, expect, it } from "vitest";
import { SOCIAL_PLATFORMS } from "./cms";
import { cleanSocialUrl, normalizeSocialLinks, SOCIAL_ORDER } from "./social";

describe("cleanSocialUrl", () => {
  it("strips Instagram's share-tracking parameter", () => {
    expect(cleanSocialUrl("https://www.instagram.com/jassminperfume?xtok=abc123")).toBe(
      "https://www.instagram.com/jassminperfume",
    );
    expect(cleanSocialUrl("https://www.instagram.com/jassmin/?igsh=MTA&igshid=x")).toBe(
      "https://www.instagram.com/jassmin/",
    );
  });

  it("strips utm_* and click ids but keeps other parameters", () => {
    expect(
      cleanSocialUrl("https://www.youtube.com/watch?v=abc&utm_source=ig&UTM_Medium=x&si=1"),
    ).toBe("https://www.youtube.com/watch?v=abc");
    expect(cleanSocialUrl("https://facebook.com/jassmin?fbclid=1&gclid=2")).toBe(
      "https://facebook.com/jassmin",
    );
  });

  it("keeps a clean URL as it is, trimming whitespace", () => {
    expect(cleanSocialUrl("  https://t.me/jassmin  ")).toBe("https://t.me/jassmin");
  });

  it("rejects anything but an absolute https URL", () => {
    expect(cleanSocialUrl("http://t.me/jassmin")).toBeNull();
    expect(cleanSocialUrl("javascript:alert(1)")).toBeNull();
    expect(cleanSocialUrl("t.me/jassmin")).toBeNull();
    expect(cleanSocialUrl("")).toBeNull();
  });
});

describe("normalizeSocialLinks", () => {
  it("orders Instagram and Telegram first, then the rest", () => {
    expect(
      normalizeSocialLinks([
        { platform: "youtube", url: "https://youtube.com/@jassmin" },
        { platform: "telegram", url: "https://t.me/jassmin" },
        { platform: "facebook", url: "https://facebook.com/jassmin" },
        { platform: "instagram", url: "https://instagram.com/jassmin" },
      ]).map((link) => link.platform),
    ).toEqual(["instagram", "telegram", "facebook", "youtube"]);
  });

  it("cleans URLs and drops invalid links and duplicates", () => {
    expect(
      normalizeSocialLinks([
        { platform: "instagram", url: "https://instagram.com/jassmin?xtok=1" },
        { platform: "instagram", url: "https://instagram.com/jassmin" },
        { platform: "telegram", url: "http://t.me/jassmin" },
      ]),
    ).toEqual([{ platform: "instagram", url: "https://instagram.com/jassmin" }]);
  });

  it("covers every platform", () => {
    expect([...SOCIAL_ORDER].sort()).toEqual([...SOCIAL_PLATFORMS].sort());
  });
});
