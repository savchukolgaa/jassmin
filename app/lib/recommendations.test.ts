import { describe, expect, it } from "vitest";
import { pendingTrioUnits } from "./recommendations";

const offer = { setSize: 3, volumeMl: 10 };
const tester = (quantity: number) => ({ packSize: 1, volumeMl: 10, quantity });

describe("pendingTrioUnits", () => {
  it("counts the testers still missing from the next trio", () => {
    expect(pendingTrioUnits([], offer)).toBe(0);
    expect(pendingTrioUnits([tester(1)], offer)).toBe(2);
    expect(pendingTrioUnits([tester(1), tester(1)], offer)).toBe(1);
    expect(pendingTrioUnits([tester(2), tester(1)], offer)).toBe(0);
    expect(pendingTrioUnits([tester(4)], offer)).toBe(2);
  });

  it("ignores other sizes and sets", () => {
    expect(pendingTrioUnits([{ packSize: 1, volumeMl: 50, quantity: 1 }], offer)).toBe(0);
    expect(pendingTrioUnits([{ packSize: 3, volumeMl: 10, quantity: 1 }], offer)).toBe(0);
  });

  it("counts every single size when the offer names no volume", () => {
    expect(
      pendingTrioUnits([{ packSize: 1, volumeMl: 50, quantity: 1 }], {
        setSize: 3,
        volumeMl: null,
      }),
    ).toBe(2);
  });

  it("is 0 without a live offer", () => {
    expect(pendingTrioUnits([tester(1)], null)).toBe(0);
  });
});
