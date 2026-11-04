import express, { type RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";
import { createAuditAdminMutation, describeAdminMutation } from "../../src/modules/admin-audit/audit-admin-mutation.middleware";
import { listAuditLogsSchema } from "../../src/modules/admin-audit/audit-log.validation";
import { CustomersRepository } from "../../src/modules/users/customers.repository";
import { StoreSettingsRepository } from "../../src/modules/store-settings/store-settings.repository";
import { VariantsRepository } from "../../src/modules/variants/variants.repository";
import { ExchangesRepository } from "../../src/modules/exchanges/exchanges.repository";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { ShippingZonesRepository } from "../../src/modules/shipping/shipping-zones.repository";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const requireAuth: RequestHandler = (req, _res, next) => {
    if (!req.headers.authorization) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    req.auth = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", roleCodes: ["ADMIN"], permissions: req.headers.authorization === "Bearer allowed" ? ["audit-logs.read.any"] : [] };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

describe("administrative audit", () => {
  it("requires authentication and the explicit audit permission", async () => {
    const list = vi.spyOn(AuditLogService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const app = createApp();
    expect((await request(app).get("/api/v1/admin/audit-logs")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/audit-logs").set("Authorization", "Bearer denied")).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/audit-logs").set("Authorization", "Bearer allowed").query({ action: "ORDER_DELIVERED" })).status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ action: "ORDER_DELIVERED" }));
    list.mockRestore();
  });

  it("builds safe filters and selects only public actor fields", async () => {
    const client = { $transaction: vi.fn(async (queries: unknown[]) => Promise.all(queries)), adminAuditLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) } };
    const service = new AuditLogService(client as unknown as PrismaClient);
    const parsed = listAuditLogsSchema.parse({ body: {}, params: {}, query: { page: "2", limit: "5", actorUserId, entityType: "CUSTOMER", from: "2026-09-01" } });
    expect(await service.list(parsed.query)).toMatchObject({ pagination: { page: 2, limit: 5, total: 0 } });
    expect(client.adminAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5, where: expect.objectContaining({ actorUserId, entityType: "CUSTOMER" }), select: expect.objectContaining({ actor: { select: { id: true, firstName: true, lastName: true, email: true } } }) }));
  });

  it("records successful admin writes, skips GET and failures, and never copies request secrets", async () => {
    const record = vi.fn(async () => ({})) as unknown as AuditLogService["record"];
    const middleware = createAuditAdminMutation({ record } as AuditLogService);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.auth = { userId: actorUserId, sessionId: entityId, roleCodes: ["ADMIN"], permissions: [] }; next(); });
    app.use(middleware);
    app.get("/api/v1/admin/shipping-zones", (_req, res) => { res.json({ success: true, data: [] }); });
    app.post("/api/v1/admin/shipping-zones", (_req, res) => { res.status(201).json({ success: true, data: { id: entityId } }); });
    app.patch("/api/v1/admin/products/:productId/variants/:variantId/stock", (_req, res) => { res.json({ success: true, data: { id: entityId } }); });
    app.post("/api/v1/admin/exchanges/:exchangeId/complete", (_req, res) => { res.status(409).json({ success: false }); });
    expect((await request(app).get("/api/v1/admin/shipping-zones")).status).toBe(200);
    expect((await request(app).post("/api/v1/admin/shipping-zones").send({ password: "secret", authorization: "Bearer secret" })).status).toBe(201);
    expect((await request(app).patch(`/api/v1/admin/products/${entityId}/variants/${entityId}/stock`).send({ quantity: 5 })).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/exchanges/${entityId}/complete`)).status).toBe(409);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "SHIPPING_ZONE_CREATE", entityType: "SHIPPING_ZONE", entityId }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "PRODUCT_VARIANT_STOCK_UPDATE" }));
    expect(JSON.stringify(vi.mocked(record).mock.calls)).not.toMatch(/secret|password|authorization/i);
  });

  it("maps order, return, exchange, and customer mutations to business entities", () => {
    const paths = [
      ["/api/v1/admin/orders/1/deliver", "ORDER_DELIVER"],
      ["/api/v1/admin/returns/1/receive", "RETURN_RECEIVE"],
      ["/api/v1/admin/exchanges/1/decision", "EXCHANGE_DECISION"],
      ["/api/v1/admin/customers/1/status", "CUSTOMER_STATUS_UPDATE"],
    ] as const;
    for (const [originalUrl, action] of paths) expect(describeAdminMutation({ method: "POST", originalUrl } as never)?.action).toBe(action);
  });

  it("writes customer status audit in the same transaction and skips a no-op", async () => {
    let status: "ACTIVE" | "INACTIVE" = "ACTIVE";
    const tx = {
      user: { findFirst: vi.fn(async () => ({ id: entityId, status })), update: vi.fn(async ({ data }: { data: { status: "ACTIVE" | "INACTIVE" } }) => { status = data.status; return { id: entityId, status }; }) },
      authSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
      adminAuditLog: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    const repository = new CustomersRepository(client as unknown as PrismaClient);
    await repository.setStatus(entityId, "INACTIVE", actorUserId);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId, action: "CUSTOMER_STATUS_UPDATE", metadata: { status: { from: "ACTIVE", to: "INACTIVE" } } }) });
    await repository.setStatus(entityId, "INACTIVE", actorUserId);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it("audits store settings in its transaction and records nothing when the update fails", async () => {
    const tx = { storeSettings: { upsert: vi.fn(async () => ({ id: 1, shippingPolicy: "Delivery in two days" })) }, adminAuditLog: { create: vi.fn(async () => ({})) } };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    const repository = new StoreSettingsRepository(client as unknown as PrismaClient);
    await repository.update({ shippingPolicy: "Delivery in two days" }, actorUserId);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "STORE_SETTINGS_UPDATE", actorUserId }) });
    tx.adminAuditLog.create.mockClear();
    tx.storeSettings.upsert.mockRejectedValueOnce(new Error("failed update"));
    await expect(repository.update({ shippingPolicy: "Failed" }, actorUserId)).rejects.toThrow("failed update");
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("audits manual stock with before and after quantities inside the stock transaction", async () => {
    const tx = {
      productVariant: { findFirst: vi.fn(async () => ({ stockQuantity: 12 })), update: vi.fn(async () => ({ id: entityId, stockQuantity: 18 })) },
      inventoryMovement: { create: vi.fn(async () => ({})) },
      adminAuditLog: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    await new VariantsRepository(client as unknown as PrismaClient).setStock(entityId, entityId, 18, actorUserId);
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "PRODUCT_VARIANT_STOCK_UPDATE", metadata: { stock: { from: 12, to: 18 } } }) });
  });

  it("audits exchange approval and order delivery in their existing transactions", async () => {
    const exchangeTx = {
      $queryRaw: vi.fn(async () => []),
      exchangeRequest: { findUnique: vi.fn(async () => ({ status: "REQUESTED" })), update: vi.fn(async () => ({ id: entityId, status: "APPROVED" })) },
      adminAuditLog: { create: vi.fn(async () => ({})) },
      notificationOutbox: { upsert: vi.fn(async () => ({})) },
    };
    const exchangeClient = { $transaction: vi.fn(async (operation: (value: typeof exchangeTx) => Promise<unknown>) => operation(exchangeTx)) };
    expect((await new ExchangesRepository(exchangeClient as unknown as PrismaClient).decide(entityId, "APPROVED", new Date(), actorUserId)).kind).toBe("UPDATED");
    expect(exchangeTx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "EXCHANGE_APPROVED", entityId }) });

    const orderTx = {
      $queryRaw: vi.fn(async () => []),
      order: { findFirst: vi.fn(async () => ({ id: entityId, status: "SHIPPED", totalMinor: 12_000n, shippingProvider: "Carrier", items: [] })), update: vi.fn(async () => ({})), findUniqueOrThrow: vi.fn(async () => ({ id: entityId, status: "DELIVERED" })) },
      orderStatusHistory: { create: vi.fn(async () => ({})) },
      adminAuditLog: { create: vi.fn(async () => ({})) },
    };
    const orderClient = { $transaction: vi.fn(async (operation: (value: typeof orderTx) => Promise<unknown>) => operation(orderTx)) };
    expect((await new OrdersRepository(orderClient as unknown as PrismaClient).transition(entityId, actorUserId, "DELIVERED", ["SHIPPED"], null)).kind).toBe("UPDATED");
    expect(orderTx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ORDER_DELIVERED", metadata: { status: { from: "SHIPPED", to: "DELIVERED" } } }) });
  });

  it("audits Shipping Zone rate changes in the rate transaction", async () => {
    const tx = {
      shippingZone: { findUnique: vi.fn(async () => ({ id: entityId })) },
      shippingMethod: { findUnique: vi.fn(async () => ({ currency: "TND" })) },
      shippingZoneRate: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({ id: entityId, priceMinor: 2_500n })) },
      adminAuditLog: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    await new ShippingZonesRepository(client as unknown as PrismaClient).upsertRate(entityId, entityId, { priceMinor: "2500" }, actorUserId);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "SHIPPING_ZONE_RATE_CREATE", entityId }) });
  });

  it("drops unapproved metadata keys before persistence", async () => {
    const tx = { adminAuditLog: { create: vi.fn(async () => ({})) } };
    await new AuditLogService().record({ actorUserId, action: "CUSTOMER_STATUS_UPDATE", entityType: "CUSTOMER", metadata: { status: { from: "ACTIVE", to: "INACTIVE" }, password: "secret", authorization: "Bearer secret" } as never }, tx as never);
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: { status: { from: "ACTIVE", to: "INACTIVE" } } }) });
  });
});
