import { AppError } from "../../common/errors/app-error";
import { ShippingPreviewRepository } from "./shipping-preview.repository";
import type { ShippingPreviewInput } from "./shipping-preview.validation";

export class ShippingPreviewService {
  constructor(private readonly repository = new ShippingPreviewRepository()) {}

  async preview(slug: string, input: ShippingPreviewInput, now = new Date()) {
    const methods = await this.repository.preview(slug, input, now);
    if (!methods) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    return { available: methods.length > 0, methods };
  }
}
