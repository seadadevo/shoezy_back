import { AppError } from "../../common/errors/app-error";
import { CustomersRepository } from "./customers.repository";
import type { ListCustomersQuery } from "./customers.validation";
export class CustomersService {
  constructor(private readonly repository = new CustomersRepository()) {}
  async list(query: ListCustomersQuery) { const r = await this.repository.list(query); return { items: r.items, pagination: { page: query.page, limit: query.limit, total: r.total, totalPages: Math.ceil(r.total / query.limit) } }; }
  async get(id: string) { const r = await this.repository.get(id); if (!r) throw new AppError(404, "Customer not found", "CUSTOMER_NOT_FOUND"); return r; }
  async setStatus(actorId: string, id: string, status: "ACTIVE" | "INACTIVE") { if (actorId === id && status === "INACTIVE") throw new AppError(409, "You cannot deactivate your own account", "CUSTOMER_SELF_LOCKOUT"); const r = await this.repository.setStatus(id, status, actorId); if (!r) throw new AppError(404, "Customer not found", "CUSTOMER_NOT_FOUND"); return r; }
}
