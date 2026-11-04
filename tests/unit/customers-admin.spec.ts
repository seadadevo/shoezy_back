import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CustomersRepository } from "../../src/modules/users/customers.repository";
import { CustomersService } from "../../src/modules/users/customers.service";
import { listCustomersSchema, updateCustomerStatusSchema } from "../../src/modules/users/customers.validation";

const customerId = "11111111-1111-4111-8111-111111111111";
describe("admin customer management", () => {
  it("validates customer filters and only the allowed status values", () => {
    expect(listCustomersSchema.safeParse({ body: {}, params: {}, query: { page: "2", search: "Amina", status: "ACTIVE" } }).success).toBe(true);
    expect(listCustomersSchema.safeParse({ body: {}, params: {}, query: { status: "BANNED" } }).success).toBe(false);
    expect(updateCustomerStatusSchema.safeParse({ body: { status: "INACTIVE" }, params: { customerId }, query: {} }).success).toBe(true);
  });
  it("prevents an admin from deactivating their own account", async () => {
    const repository = { setStatus: vi.fn() };
    const service = new CustomersService(repository as unknown as CustomersRepository);
    await expect(service.setStatus(customerId, customerId, "INACTIVE")).rejects.toMatchObject({ code: "CUSTOMER_SELF_LOCKOUT" });
    expect(repository.setStatus).not.toHaveBeenCalled();
  });
  it("filters by customer RBAC membership and searchable profile fields", async () => {
    const client = { $transaction: vi.fn(async (queries: unknown[]) => Promise.all(queries)), user: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) } };
    const repository = new CustomersRepository(client as unknown as PrismaClient);
    await repository.list({ page: 1, limit: 20, search: "Amina", sortBy: "createdAt", sortOrder: "desc" });
    expect(client.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ roles: { some: { role: { code: "CUSTOMER" } } }, OR: expect.arrayContaining([{ email: { contains: "Amina", mode: "insensitive" } }, { phone: { contains: "Amina", mode: "insensitive" } }]) }) }));
  });
  it("revokes active sessions atomically when a customer becomes inactive", async () => {
    const tx = { user: { findFirst: vi.fn(async () => ({ id: customerId })), update: vi.fn(async () => ({ id: customerId, status: "INACTIVE" })) }, authSession: { updateMany: vi.fn(async () => ({ count: 2 })) } };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    const repository = new CustomersRepository(client as unknown as PrismaClient);
    expect(await repository.setStatus(customerId, "INACTIVE")).toMatchObject({ status: "INACTIVE" });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({ where: { userId: customerId, revokedAt: null }, data: expect.objectContaining({ revokedAt: expect.any(Date), revokeReason: "ACCOUNT_INACTIVE" }) });
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
});
