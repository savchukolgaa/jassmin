import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { CART_STATUSES, GENDERS, ORDER_STATUSES, PAYMENT_STATUSES } from "~/lib/enums";
import {
  cartStatusType,
  genderType,
  orderStatusType,
  paymentStatusType,
  products,
  users,
} from "./schema";

/** TS column key (snake_case is applied later, by `casing`) → [SQL type, not null, has default]. */
function describeColumns(table: Parameters<typeof getTableConfig>[0]) {
  return Object.fromEntries(
    getTableConfig(table).columns.map((column) => [
      column.name,
      [column.getSQLType(), column.notNull, column.hasDefault],
    ]),
  );
}

describe("enums", () => {
  it("match the shared TS values from ~/lib/enums", () => {
    expect(genderType.enumName).toBe("gender_type");
    expect(genderType.enumValues).toEqual([...GENDERS]);
    expect(orderStatusType.enumName).toBe("order_status_type");
    expect(orderStatusType.enumValues).toEqual([...ORDER_STATUSES]);
    expect(paymentStatusType.enumName).toBe("payment_status_type");
    expect(paymentStatusType.enumValues).toEqual([...PAYMENT_STATUSES]);
    expect(cartStatusType.enumName).toBe("cart_status_type");
    expect(cartStatusType.enumValues).toEqual([...CART_STATUSES]);
  });
});

describe("users", () => {
  it("has the specified columns", () => {
    expect(describeColumns(users)).toEqual({
      id: ["serial", true, true],
      fullName: ["varchar(255)", true, false],
      email: ["varchar(255)", true, false],
      passwordHash: ["varchar(255)", true, false],
      phone: ["varchar(50)", false, false],
      acquisitionChannel: ["text", true, true],
      lastLoginAt: ["timestamp with time zone", false, false],
      createdAt: ["timestamp with time zone", true, true],
    });
  });

  it("makes email unique and defaults acquisition_channel to 'direct'", () => {
    const { columns } = getTableConfig(users);

    expect(columns.find((c) => c.name === "email")?.isUnique).toBe(true);
    expect(columns.find((c) => c.name === "acquisitionChannel")?.default).toBe("direct");
  });
});

describe("products", () => {
  it("has the specified columns", () => {
    expect(describeColumns(products)).toEqual({
      id: ["serial", true, true],
      publicId: ["uuid", true, true],
      title: ["varchar(255)", true, false],
      brand: ["varchar(255)", true, false],
      gender: ["gender_type", true, false],
      fragranceFamily: ["text", false, false],
      description: ["text", false, false],
      price: ["numeric(10, 2)", true, false],
      volumeMl: ["integer", true, false],
      packSize: ["integer", true, true],
      stockQuantity: ["integer", true, true],
      imageUrl: ["text", false, false],
      createdAt: ["timestamp with time zone", true, true],
    });
  });

  it("has the checks, the unique public_id and the gender index", () => {
    const { checks, columns, indexes } = getTableConfig(products);

    expect(checks.map((c) => c.name).sort()).toEqual([
      "products_pack_size_check",
      "products_stock_quantity_check",
    ]);
    expect(columns.find((c) => c.name === "publicId")?.isUnique).toBe(true);
    expect(indexes.map((i) => i.config.name)).toEqual(["products_gender_idx"]);
  });
});
