import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { UsersRepository } from "../../src/modules/users/users.repository";

const userId = "11111111-1111-4111-8111-111111111111";

describe("UsersRepository legacy phone uniqueness", () => {
  it.each(["20123456", "21620123456", "0021620123456", "+21620123456"])(
    "rejects a profile update when stored phone %s matches the incoming canonical phone",
    async (storedPhone) => {
      const updateMany = vi.fn();
      const findFirst = vi.fn(async (input: { where: { phone: { in: string[] } } }) =>
        input.where.phone.in.includes(storedPhone) ? { id: "other-user" } : null,
      );
      const client = { user: { findFirst, updateMany } } as unknown as PrismaClient;

      await expect(
        new UsersRepository(client).updateProfile(userId, { phone: "+21620123456" }),
      ).rejects.toMatchObject({ code: "DUPLICATE_PHONE" });

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: { not: userId },
          phone: { in: ["+21620123456", "20123456", "21620123456", "0021620123456"] },
        },
        select: { id: true },
      });
      expect(updateMany).not.toHaveBeenCalled();
    },
  );
});
