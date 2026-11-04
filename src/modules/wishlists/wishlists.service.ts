import { AppError } from "../../common/errors/app-error";
import { toWishlistDto } from "./wishlists.dto";
import { WishlistsRepository } from "./wishlists.repository";
import type { AddWishlistItemInput, ListWishlistQuery } from "./wishlists.validation";
export interface WishlistsStore { list: WishlistsRepository["list"]; add: WishlistsRepository["add"]; delete: WishlistsRepository["delete"]; }
export class WishlistsService { constructor(private readonly repository: WishlistsStore = new WishlistsRepository()) {}
  async list(userId: string, query: ListWishlistQuery, now = new Date()) { const result = await this.repository.list(userId, query); return { items: result.items.map((item) => toWishlistDto(item, now)), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } }; }
  async add(userId: string, input: AddWishlistItemInput, now = new Date()) { const result = await this.repository.add(userId, input, now); if (result === "PRODUCT_NOT_FOUND") throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND"); if (result === "VARIANT_NOT_FOUND") throw new AppError(404, "Product variant not found", "PRODUCT_VARIANT_NOT_FOUND"); return toWishlistDto(result, now); }
  async delete(userId: string, itemId: string): Promise<void> { if (!await this.repository.delete(userId, itemId)) throw new AppError(404, "Wishlist item not found", "WISHLIST_ITEM_NOT_FOUND"); }
}
