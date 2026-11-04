import { InventoryRepository } from "./inventory.repository";
import type { ListInventoryMovementsQuery } from "./inventory.validation";

export class InventoryService {
  constructor(private readonly repository = new InventoryRepository()) {}
  async list(query: ListInventoryMovementsQuery) {
    const result = await this.repository.list(query);
    return { items: result.items, pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
  }
}
