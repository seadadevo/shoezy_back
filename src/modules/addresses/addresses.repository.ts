import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { addressSelect, type AddressRecord } from "./addresses.types";
import type { CreateAddressInput, UpdateAddressInput } from "./addresses.validation";

const MAX_SERIALIZABLE_ATTEMPTS = 3;

export class AddressesRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.client.$transaction(operation, { isolationLevel: "Serializable" });
      } catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS) throw error;
      }
    }
    throw new Error("Serializable transaction retry exhausted");
  }

  listOwned(userId: string): Promise<AddressRecord[]> {
    return this.client.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      select: addressSelect,
    });
  }

  findOwned(userId: string, addressId: string): Promise<AddressRecord | null> {
    return this.client.address.findFirst({
      where: { id: addressId, userId },
      select: addressSelect,
    });
  }

  createOwned(userId: string, input: CreateAddressInput): Promise<AddressRecord> {
    return this.serializable(async (transaction) => {
      const addressCount = await transaction.address.count({ where: { userId } });
      const makeDefault = addressCount === 0 || input.isDefault === true;
      if (makeDefault) {
        await transaction.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return transaction.address.create({
        data: { ...input, userId, isDefault: makeDefault },
        select: addressSelect,
      });
    });
  }

  updateOwned(
    userId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<AddressRecord | null> {
    return this.serializable(async (transaction) => {
      const owned = await transaction.address.findFirst({
        where: { id: addressId, userId },
        select: { id: true },
      });
      if (!owned) return null;
      if (input.isDefault === true) {
        await transaction.address.updateMany({
          where: { userId, id: { not: addressId }, isDefault: true },
          data: { isDefault: false },
        });
      }
      return transaction.address.update({ where: { id: addressId }, data: input, select: addressSelect });
    });
  }

  setDefaultOwned(userId: string, addressId: string): Promise<AddressRecord | null> {
    return this.serializable(async (transaction) => {
      const owned = await transaction.address.findFirst({
        where: { id: addressId, userId },
        select: { id: true, isDefault: true },
      });
      if (!owned) return null;
      if (!owned.isDefault) {
        await transaction.address.updateMany({
          where: { userId, id: { not: addressId }, isDefault: true },
          data: { isDefault: false },
        });
        await transaction.address.update({ where: { id: addressId }, data: { isDefault: true } });
      }
      return transaction.address.findUnique({ where: { id: addressId }, select: addressSelect });
    });
  }

  async deleteOwned(userId: string, addressId: string): Promise<boolean> {
    const result = await this.client.address.deleteMany({ where: { id: addressId, userId } });
    return result.count === 1;
  }
}
