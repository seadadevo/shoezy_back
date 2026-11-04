import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AddressesService, type AddressesStore } from "../../src/modules/addresses/addresses.service";
import type { AddressRecord } from "../../src/modules/addresses/addresses.types";
import { createAddressSchema, updateAddressSchema } from "../../src/modules/addresses/addresses.validation";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const addressId = "33333333-3333-4333-8333-333333333333";

function address(overrides: Partial<AddressRecord> = {}): AddressRecord {
  return {
    id: addressId,
    userId,
    type: "BOTH",
    label: null,
    recipientName: "Test User",
    phone: "+21620000000",
    countryCode: "TN",
    state: null,
    city: "Tunis",
    area: null,
    postalCode: null,
    line1: "1 Main Street",
    line2: null,
    latitude: new Prisma.Decimal("36.8065"),
    longitude: new Prisma.Decimal("10.1815"),
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function store(): AddressesStore {
  return {
    listOwned: vi.fn(async (ownerId) => ownerId === userId ? [address()] : []),
    findOwned: vi.fn(async (ownerId, id) => ownerId === userId && id === addressId ? address() : null),
    createOwned: vi.fn(async (ownerId, input) => address({ userId: ownerId, ...input })),
    updateOwned: vi.fn(async (ownerId, id, input) => ownerId === userId && id === addressId ? address(input) : null),
    setDefaultOwned: vi.fn(async (ownerId, id) => ownerId === userId && id === addressId ? address() : null),
    deleteOwned: vi.fn(async (ownerId, id) => ownerId === userId && id === addressId),
  };
}

describe("addresses service ownership", () => {
  it("lists only addresses selected for the authenticated owner", async () => {
    const repository = store();
    expect(await new AddressesService(repository).list(userId)).toHaveLength(1);
    expect(repository.listOwned).toHaveBeenCalledWith(userId);
  });

  it("uses 404 for another customer's address", async () => {
    await expect(new AddressesService(store()).get(otherUserId, addressId)).rejects.toMatchObject({
      statusCode: 404,
      code: "ADDRESS_NOT_FOUND",
    });
  });

  it("passes authenticated identity into create and never takes it from input", async () => {
    const repository = store();
    await new AddressesService(repository).create(userId, {
      recipientName: "Test User",
      phone: "+21620000000",
      countryCode: "TN",
      city: "Tunis",
      line1: "1 Main Street",
    });
    expect(repository.createOwned).toHaveBeenCalledWith(userId, expect.not.objectContaining({ userId: expect.anything() }));
  });

  it("returns coordinate decimals as strings", async () => {
    const result = await new AddressesService(store()).get(userId, addressId);
    expect(result.latitude).toBe("36.8065");
    expect(result.longitude).toBe("10.1815");
  });
});

describe("addresses validation", () => {
  const valid = {
    recipientName: "Test User",
    phone: "+21620000000",
    countryCode: "tn",
    city: "Tunis",
    line1: "1 Main Street",
  };

  it("normalizes country code and accepts only BOTH", () => {
    const result = createAddressSchema.parse({ body: { ...valid, type: "BOTH" }, params: {}, query: {} });
    expect(result.body.countryCode).toBe("TN");
    expect(createAddressSchema.safeParse({ body: { ...valid, type: "HOME" }, params: {}, query: {} }).success).toBe(false);
  });

  it("requires Tunisia for new and updated delivery addresses", () => {
    expect(createAddressSchema.safeParse({ body: { ...valid, countryCode: "FR" }, params: {}, query: {} }).success).toBe(false);
    expect(updateAddressSchema.safeParse({ body: { countryCode: "EG" }, params: { addressId }, query: {} }).success).toBe(false);
  });

  it.each(["20123456", "+21620123456", "21620123456", "0021620123456"])(
    "normalizes saved-address phone %s",
    (phone) => {
      const result = createAddressSchema.parse({ body: { ...valid, phone }, params: {}, query: {} });
      expect(result.body.phone).toBe("+21620123456");
    },
  );

  it.each(["30123456", "60123456", "70123456", "80123456"])(
    "rejects invalid saved-address phone %s",
    (phone) => {
      expect(createAddressSchema.safeParse({ body: { ...valid, phone }, params: {}, query: {} }).success).toBe(false);
    },
  );

  it.each([
    ["latitude", "90.0000001"],
    ["latitude", "-90.0000001"],
    ["longitude", "180.0000001"],
    ["longitude", "-180.0000001"],
  ])("rejects invalid %s %s", (field, value) => {
    expect(createAddressSchema.safeParse({ body: { ...valid, [field]: value }, params: {}, query: {} }).success).toBe(false);
  });

  it("rejects userId injection and invalid country codes", () => {
    expect(createAddressSchema.safeParse({ body: { ...valid, userId }, params: {}, query: {} }).success).toBe(false);
    expect(createAddressSchema.safeParse({ body: { ...valid, countryCode: "TUN" }, params: {}, query: {} }).success).toBe(false);
  });

  it("rejects empty patches", () => {
    expect(updateAddressSchema.safeParse({ body: {}, params: { addressId }, query: {} }).success).toBe(false);
  });
});
