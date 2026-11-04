import { AppError } from "../../common/errors/app-error";
import { emptyCartDto, toCartDto } from "./carts.dto";
import { CartsRepository, type CartOwner } from "./carts.repository";
import type { CartMutationResult } from "./carts.types";
import type { AddCartItemInput, SetCartDiscountCodeInput, UpdateCartItemInput } from "./carts.validation";

export interface CartsStore {
  getPriced: CartsRepository["getPriced"];
  addItem: CartsRepository["addItem"];
  updateItem: CartsRepository["updateItem"];
  deleteItem: CartsRepository["deleteItem"];
  clear: CartsRepository["clear"];
  setDiscountCode: CartsRepository["setDiscountCode"];
  createGuestSession?: CartsRepository["createGuestSession"];
  addFirstGuestItem?: CartsRepository["addFirstGuestItem"];
  validGuestSession?: CartsRepository["validGuestSession"];
}

export class CartsService {
  constructor(private readonly repository: CartsStore = new CartsRepository()) {}

  async get(owner: CartOwner, now = new Date()) {
    const context = await this.repository.getPriced(owner, now);
    return context.cart && context.calculation ? toCartDto(context.cart, context.calculation, now) : emptyCartDto();
  }

  private throwMutation(result: CartMutationResult): never {
    if (result === "CART_SESSION_INVALID") throw new AppError(404, "Guest cart session is unavailable", "GUEST_CART_SESSION_INVALID");
    if (result === "ITEM_NOT_FOUND") throw new AppError(404, "Cart item not found", "CART_ITEM_NOT_FOUND");
    if (result === "VARIANT_UNAVAILABLE") throw new AppError(409, "Product variant is not currently available", "CART_VARIANT_UNAVAILABLE");
    if (result === "INSUFFICIENT_STOCK") throw new AppError(409, "Requested quantity exceeds current stock", "CART_INSUFFICIENT_STOCK");
    throw new AppError(409, "Cart quantity exceeds the supported integer range", "CART_QUANTITY_LIMIT");
  }

  async addItem(owner: CartOwner, input: AddCartItemInput, now = new Date()) {
    const result = await this.repository.addItem(owner, input.variantId, input.quantity, now);
    if (typeof result === "string") this.throwMutation(result);
    return this.get(owner, now);
  }

  async updateItem(owner: CartOwner, cartItemId: string, input: UpdateCartItemInput, now = new Date()) {
    const result = await this.repository.updateItem(owner, cartItemId, input.quantity, now);
    if (typeof result === "string") this.throwMutation(result);
    return this.get(owner, now);
  }

  async deleteItem(owner: CartOwner, cartItemId: string, now = new Date()) {
    if (!await this.repository.deleteItem(owner, cartItemId)) throw new AppError(404, "Cart item not found", "CART_ITEM_NOT_FOUND");
    return this.get(owner, now);
  }

  async clear(owner: CartOwner) {
    await this.repository.clear(owner);
  }

  async setDiscountCode(owner: CartOwner, input: SetCartDiscountCodeInput, now = new Date()) {
    const context = await this.repository.getPriced(owner, now, input.code);
    if (!context.cart || !context.calculation?.eligibleCoupon) throw new AppError(409, "Discount code is invalid or not currently eligible", "DISCOUNT_CODE_NOT_ELIGIBLE");
    await this.repository.setDiscountCode(owner, input.code);
    return this.get(owner, now);
  }

  async removeDiscountCode(owner: CartOwner, now = new Date()) {
    await this.repository.setDiscountCode(owner, null);
    return this.get(owner, now);
  }
  createGuestSession() { return this.repository.createGuestSession?.() ?? new CartsRepository().createGuestSession(); }
  validGuestSession(token: string) { return this.repository.validGuestSession?.(token) ?? new CartsRepository().validGuestSession(token); }
  async addFirstGuestItem(input: AddCartItemInput, now = new Date()) {
    const result = await (this.repository.addFirstGuestItem?.(input.variantId, input.quantity, now) ?? new CartsRepository().addFirstGuestItem(input.variantId, input.quantity, now));
    if (result.kind !== "CREATED") this.throwMutation(result.kind);
    return { sessionToken: result.sessionToken, cart: await this.get({ sessionToken: result.sessionToken }, now) };
  }
}
