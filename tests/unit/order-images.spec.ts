import { describe, expect, it } from "vitest";
import { selectPurchasedImageUrl, snapshotImageUrl, type OrderImageMedia } from "../../src/modules/orders/order-images";
import { toOrderDetailDto } from "../../src/modules/orders/orders.dto";
import { orderDetailSelect } from "../../src/modules/orders/orders.types";

const productId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const image = (overrides: Partial<OrderImageMedia>): OrderImageMedia => ({
  productId,
  variantId: null,
  type: "IMAGE",
  mediaType: "IMAGE",
  url: "https://cdn.example.com/product.jpg",
  isPrimary: false,
  ...overrides,
});

function orderItem(snapshotJson: unknown, variantMedia: OrderImageMedia[], productMedia: OrderImageMedia[]) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    orderNumber: "SHZ-IMAGE",
    userId: "44444444-4444-4444-8444-444444444444",
    guestSessionTokenHash: null,
    status: "PENDING",
    paymentMethod: "COD",
    paymentStatus: "PENDING",
    currency: "TND",
    customerEmail: "customer@example.com",
    customerPhone: "+21620123456",
    customerFirstName: "Image",
    customerLastName: "Customer",
    subtotalMinor: 10_000n,
    discountMinor: 0n,
    shippingMinor: 0n,
    totalMinor: 10_000n,
    paidMinor: 0n,
    refundedMinor: 0n,
    paidAt: null,
    notes: null,
    trackingNumber: null,
    shippingProvider: null,
    placedAt: new Date("2026-10-10T10:00:00Z"),
    confirmedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-10-10T10:00:00Z"),
    updatedAt: new Date("2026-10-10T10:00:00Z"),
    shippingMethodCode: "STANDARD",
    shippingMethodName: "Standard",
    shippingZoneCode: null,
    shippingZoneName: null,
    whatsappConfirmationNumber: null,
    whatsappStoreName: null,
    address: null,
    items: [{
      id: "55555555-5555-4555-8555-555555555555",
      productId,
      variantId,
      productName: "Runner",
      variantName: "Blue / 42",
      sku: "RUN-BLUE-42",
      quantity: 1,
      unitPriceMinor: 10_000n,
      discountMinor: 0n,
      lineTotalMinor: 10_000n,
      snapshotJson,
      variant: { media: variantMedia },
      product: { media: productMedia },
    }],
    statusHistory: [],
    discountRedemptions: [],
  };
}

describe("order item image selection", () => {
  it("uses the exact purchased variant image first", () => {
    const media = [
      image({ url: "https://cdn.example.com/product-primary.jpg", isPrimary: true }),
      image({ variantId, url: "https://cdn.example.com/variant.jpg" }),
    ];
    expect(selectPurchasedImageUrl(media, productId, variantId)).toBe("https://cdn.example.com/variant.jpg");
  });

  it("uses the product-level primary image before the first product-level image", () => {
    expect(selectPurchasedImageUrl([
      image({ url: "https://cdn.example.com/product-first.jpg" }),
      image({ url: "https://cdn.example.com/product-primary.jpg", isPrimary: true }),
    ], productId, variantId)).toBe("https://cdn.example.com/product-primary.jpg");
  });

  it("loads enough candidates to skip unusable media in historical orders", () => {
    expect("take" in orderDetailSelect.items.select.variant.select.media).toBe(false);
    expect("take" in orderDetailSelect.items.select.product.select.media).toBe(false);
    const historicalDto = toOrderDetailDto(orderItem({}, [
      image({ variantId, url: "ftp://cdn.example.com/unusable.jpg", isPrimary: true }),
      image({ variantId, url: "https://cdn.example.com/valid-variant.jpg" }),
    ], [
      image({ url: "ftp://cdn.example.com/unusable-product.jpg", isPrimary: true }),
      image({ url: "https://cdn.example.com/valid-product.jpg" }),
    ]) as never);
    expect(historicalDto.items[0]?.imageUrl).toBe("https://cdn.example.com/valid-variant.jpg");
    const productFallback = toOrderDetailDto(orderItem({}, [], [
      image({ url: "ftp://cdn.example.com/unusable-product.jpg", isPrimary: true }),
      image({ url: "https://cdn.example.com/valid-product.jpg" }),
    ]) as never);
    expect(productFallback.items[0]?.imageUrl).toBe("https://cdn.example.com/valid-product.jpg");
  });

  it("never selects an image owned by another variant", () => {
    expect(selectPurchasedImageUrl([
      image({ variantId: "66666666-6666-4666-8666-666666666666", url: "https://cdn.example.com/other-variant.jpg", isPrimary: true }),
      image({ url: "https://cdn.example.com/product.jpg" }),
    ], productId, variantId)).toBe("https://cdn.example.com/product.jpg");
  });

  it("returns null when no valid purchased-variant or product-level image exists", () => {
    expect(selectPurchasedImageUrl([
      image({ variantId, url: "ftp://cdn.example.com/invalid.jpg" }),
      image({ variantId: "66666666-6666-4666-8666-666666666666", url: "https://cdn.example.com/other-variant.jpg" }),
    ], productId, variantId)).toBeNull();
  });

  it("supports the historical order fallback without leaking media metadata", () => {
    const historicalDto = toOrderDetailDto(orderItem({}, [], [image({ url: "https://cdn.example.com/fallback.jpg" })]) as never);
    expect(historicalDto.items[0]?.imageUrl).toBe("https://cdn.example.com/fallback.jpg");
    expect(historicalDto.items[0]).not.toHaveProperty("product");
    expect(historicalDto.items[0]).not.toHaveProperty("variant");
    expect(JSON.stringify(historicalDto.items[0])).not.toContain("storageProvider");
    expect(JSON.stringify(historicalDto.items[0])).not.toContain("storageKey");
  });

  it("keeps the stored snapshot image ahead of current media", () => {
    const snapshot = { imageUrl: "https://cdn.example.com/snapshot.jpg" };
    expect(snapshotImageUrl(snapshot)).toBe(snapshot.imageUrl);
    const snapshotDto = toOrderDetailDto(orderItem(snapshot, [image({ variantId, url: "https://cdn.example.com/current.jpg" })], []) as never);
    expect(snapshotDto.items[0]?.imageUrl).toBe(snapshot.imageUrl);
  });

  it("excludes video media", () => {
    expect(selectPurchasedImageUrl([
      image({ variantId, type: "VIDEO", mediaType: "VIDEO", url: "https://cdn.example.com/demo.mp4" }),
      image({ url: "https://cdn.example.com/product.jpg" }),
    ], productId, variantId)).toBe("https://cdn.example.com/product.jpg");
    expect(selectPurchasedImageUrl([
      image({ variantId, type: "VIDEO", mediaType: "VIDEO", url: "https://cdn.example.com/demo.mp4" }),
    ], productId, variantId)).toBeNull();
  });
});

