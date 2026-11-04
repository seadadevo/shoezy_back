import { AppError } from "../../common/errors/app-error";
import { toCheckoutPreviewDto } from "./checkout.dto";
import { CheckoutRepository } from "./checkout.repository";
import type { CheckoutPreviewInput } from "./checkout.validation";
import type { GuestCheckoutInput } from "./guest-checkout.validation";
export class CheckoutService {
  constructor(private readonly repository = new CheckoutRepository()) {}
  async preview(userId: string, input: CheckoutPreviewInput, now = new Date()) {
    return this.toPreview(await this.repository.preview(userId, input, now), now);
  }
  async previewGuest(sessionToken: string, input: GuestCheckoutInput, now = new Date()) {
    return this.toPreview(await this.repository.previewGuest(sessionToken, input, now), now);
  }
  private toPreview(context: Awaited<ReturnType<CheckoutRepository["preview"]>>, now: Date) {
    if (context.kind === "ADDRESS_NOT_FOUND") throw new AppError(404, "Address not found", "ADDRESS_NOT_FOUND");
    if (context.kind === "SHIPPING_METHOD_NOT_FOUND") throw new AppError(404, "Shipping method not found", "SHIPPING_METHOD_NOT_FOUND");
    if (context.kind === "CART_EMPTY") throw new AppError(409, "Cart is empty", "CHECKOUT_CART_EMPTY");
    if (context.kind === "CURRENCY_MISMATCH") throw new AppError(409, "Cart and shipping currencies do not match", "CHECKOUT_CURRENCY_MISMATCH");
    if (context.kind === "SHIPPING_RATE_NOT_AVAILABLE") throw new AppError(409, "No shipping rate is available for this address and method", "SHIPPING_RATE_NOT_AVAILABLE");
    if (context.kind === "ITEM_UNAVAILABLE") throw new AppError(409, "One or more Cart items are unavailable", "CHECKOUT_ITEM_UNAVAILABLE", { variantIds: context.variantIds });
    if (context.kind === "INSUFFICIENT_STOCK") throw new AppError(409, "Cart quantity exceeds current stock", "CHECKOUT_INSUFFICIENT_STOCK", { variantIds: context.variantIds });
    if (context.kind === "DISCOUNT_NOT_ELIGIBLE") throw new AppError(409, "The Cart discount is no longer eligible", "CHECKOUT_DISCOUNT_CHANGED");
    return toCheckoutPreviewDto(context, now);
  }
}
