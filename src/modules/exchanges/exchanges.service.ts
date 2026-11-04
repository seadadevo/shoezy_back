import { AppError } from "../../common/errors/app-error";
import { toExchangeDto } from "./exchanges.dto";
import { ExchangesRepository } from "./exchanges.repository";
import type { CreateExchangeInput, ListAdminExchangesQuery, ListOwnExchangesQuery } from "./exchanges.validation";
const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
export class ExchangesService {
  constructor(private readonly repository = new ExchangesRepository()) {}
  async create(userId: string, orderId: string, input: CreateExchangeInput, now = new Date()) {
    const result = await this.repository.create(userId, orderId, input, now);
    if (result === "ORDER_NOT_ELIGIBLE") throw new AppError(409, "Only an owned delivered order can be exchanged", "EXCHANGE_ORDER_NOT_ELIGIBLE");
    if (result === "WINDOW_EXPIRED") throw new AppError(409, "Exchange window has expired", "EXCHANGE_WINDOW_EXPIRED");
    if (result === "ITEM_NOT_FOUND") throw new AppError(404, "Order item not found", "EXCHANGE_ORDER_ITEM_NOT_FOUND");
    if (result === "VARIANT_INVALID") throw new AppError(409, "Replacement must be an active variant of the same product", "EXCHANGE_VARIANT_INVALID");
    if (result === "SAME_VARIANT") throw new AppError(409, "Replacement variant must differ from the original", "EXCHANGE_SAME_VARIANT");
    if (result === "PRICE_MISMATCH") throw new AppError(409, "Size exchange cannot require a price adjustment", "EXCHANGE_PRICE_MISMATCH");
    if (result === "QUANTITY_EXCEEDED") throw new AppError(409, "Exchange quantity exceeds the available purchased quantity", "EXCHANGE_QUANTITY_EXCEEDED");
    return toExchangeDto(result);
  }
  async listOwn(userId: string, query: ListOwnExchangesQuery) { const r = await this.repository.listOwn(userId, query); return { items: r.items.map(toExchangeDto), pagination: pagination(query.page, query.limit, r.total) }; }
  async getOwn(userId: string, id: string) { const r = await this.repository.findOwn(userId, id); if (!r) throw new AppError(404, "Exchange not found", "EXCHANGE_NOT_FOUND"); return toExchangeDto(r); }
  async listAny(query: ListAdminExchangesQuery) { const r = await this.repository.listAny(query); return { items: r.items.map(toExchangeDto), pagination: pagination(query.page, query.limit, r.total) }; }
  async getAny(id: string) { const r = await this.repository.findAny(id); if (!r) throw new AppError(404, "Exchange not found", "EXCHANGE_NOT_FOUND"); return toExchangeDto(r); }
  async decide(id: string, status: "APPROVED" | "REJECTED", now = new Date(), actorId?: string) { const r = await this.repository.decide(id, status, now, actorId); if (r.kind === "NOT_FOUND") throw new AppError(404, "Exchange not found", "EXCHANGE_NOT_FOUND"); if (r.kind === "INVALID") throw new AppError(409, "Exchange transition is not allowed", "EXCHANGE_TRANSITION_INVALID"); return { exchange: toExchangeDto(r.value), idempotentReplay: r.kind === "REPLAYED" }; }
  async complete(actorId: string, id: string, now = new Date()) { const r = await this.repository.complete(actorId, id, now); if (r.kind === "NOT_FOUND") throw new AppError(404, "Exchange not found", "EXCHANGE_NOT_FOUND"); if (r.kind === "INVALID") throw new AppError(409, "Exchange must be approved", "EXCHANGE_TRANSITION_INVALID"); if (r.kind === "INSUFFICIENT_STOCK") throw new AppError(409, "Replacement variant has insufficient stock", "EXCHANGE_INSUFFICIENT_STOCK"); if (r.kind === "RESTORE_OVERFLOW") throw new AppError(409, "Original variant stock cannot be restored", "EXCHANGE_STOCK_RESTORE_OVERFLOW"); return { exchange: toExchangeDto(r.value), idempotentReplay: r.kind === "REPLAYED" }; }
}
