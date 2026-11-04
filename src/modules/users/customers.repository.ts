import { Prisma, type PrismaClient, type UserStatus } from "@prisma/client";
import { prisma } from "../../config/database";
import { profileSelect } from "./users.types";
import type { ListCustomersQuery } from "./customers.validation";
import { AuditLogService } from "../admin-audit/audit-log.service";

const customerWhere: Prisma.UserWhereInput = { deletedAt: null, roles: { some: { role: { code: "CUSTOMER" } } }, NOT: { roles: { some: { role: { code: "ADMIN" } } } } };
export class CustomersRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  async list(query: ListCustomersQuery) {
    const where: Prisma.UserWhereInput = { ...customerWhere, status: query.status, ...(query.search ? { OR: [{ firstName: { contains: query.search, mode: "insensitive" } }, { lastName: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }, { phone: { contains: query.search, mode: "insensitive" } }] } : {}) };
    const [items, total] = await this.client.$transaction([
      this.client.user.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }], select: profileSelect }),
      this.client.user.count({ where }),
    ]);
    return { items, total };
  }
  async get(customerId: string) {
    const customer = await this.client.user.findFirst({ where: { ...customerWhere, id: customerId }, select: { ...profileSelect, addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], select: { id: true, label: true, recipientName: true, phone: true, countryCode: true, state: true, city: true, area: true, postalCode: true, line1: true, line2: true, isDefault: true } }, orders: { take: 10, orderBy: { createdAt: "desc" }, select: { id: true, orderNumber: true, status: true, paymentStatus: true, totalMinor: true, paidMinor: true, refundedMinor: true, currency: true, createdAt: true } } } });
    if (!customer) return null;
    const [totalOrders, deliveredOrders, cancelledOrders, paid] = await this.client.$transaction([
      this.client.order.count({ where: { userId: customerId } }),
      this.client.order.count({ where: { userId: customerId, status: { in: ["DELIVERED", "RETURNED"] } } }),
      this.client.order.count({ where: { userId: customerId, status: "CANCELLED" } }),
      this.client.order.aggregate({ where: { userId: customerId }, _sum: { paidMinor: true, refundedMinor: true } }),
    ]);
    const { orders, ...profile } = customer;
    return { ...profile, summary: { totalOrders, deliveredOrders, cancelledOrders, netPaidMinor: ((paid._sum.paidMinor ?? 0n) - (paid._sum.refundedMinor ?? 0n)).toString() }, recentOrders: orders.map((order) => ({ ...order, totalMinor: order.totalMinor.toString(), paidMinor: order.paidMinor.toString(), refundedMinor: order.refundedMinor.toString() })) };
  }
  async setStatus(customerId: string, status: UserStatus, actorId?: string) {
    return this.client.$transaction(async (tx) => {
      const current = await tx.user.findFirst({ where: { ...customerWhere, id: customerId }, select: { id: true, status: true } });
      if (!current) return null;
      const customer = await tx.user.update({ where: { id: customerId }, data: { status }, select: profileSelect });
      if (status === "INACTIVE") await tx.authSession.updateMany({ where: { userId: customerId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "ACCOUNT_INACTIVE" } });
      if (actorId && current.status !== status) await new AuditLogService().record({ actorUserId: actorId, action: "CUSTOMER_STATUS_UPDATE", entityType: "CUSTOMER", entityId: customerId, metadata: { status: { from: current.status, to: status } } }, tx);
      return customer;
    }, { isolationLevel: "Serializable" });
  }
}
