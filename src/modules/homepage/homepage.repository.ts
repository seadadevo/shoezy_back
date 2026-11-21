import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isCheckConstraintError } from "../../common/utils/prisma-errors";
import type {
  HomepageBannerPlacement,
  HomepageBannerRecord,
  BannerTranslationsInput,
} from "./homepage.types";
import type {
  CreateHomepageBannerInput,
  ListAdminBannersQuery,
  UpdateHomepageBannerInput,
} from "./homepage.validation";

export class HomepageRepositoryError extends Error {
  constructor(public readonly code: "INVALID_DATE_RANGE" | "BANNER_NOT_FOUND") {
    super(code);
  }
}

export const bannerSelect = {
  id: true,
  placement: true,
  ctaUrl: true,
  desktopImageUrl: true,
  mobileImageUrl: true,
  desktopVideoUrl: true,
  desktopVideoMimeType: true,
  desktopVideoStorageProvider: true,
  desktopVideoStorageKey: true,
  mobileVideoUrl: true,
  mobileVideoMimeType: true,
  mobileVideoStorageProvider: true,
  mobileVideoStorageKey: true,
  backgroundColor: true,
  textColor: true,
  sortOrder: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  promotionId: true,
  createdAt: true,
  updatedAt: true,
  translations: true,
  promotion: {
    select: {
      id: true,
      name: true,
      code: true,
      isActive: true,
    },
  },
} as const satisfies Prisma.HomepageBannerSelect;

type HomepageVideoMetadata = {
  desktopVideoUrl?: string | null;
  desktopVideoMimeType?: string | null;
  desktopVideoStorageProvider?: string | null;
  desktopVideoStorageKey?: string | null;
  mobileVideoUrl?: string | null;
  mobileVideoMimeType?: string | null;
  mobileVideoStorageProvider?: string | null;
  mobileVideoStorageKey?: string | null;
};

export type PersistedBannerCreateInput = Omit<
  CreateHomepageBannerInput,
  "startsAt" | "endsAt" | "translations"
> & HomepageVideoMetadata & {
  startsAt?: Date | null;
  endsAt?: Date | null;
  translations?: BannerTranslationsInput;
};

export type PersistedBannerUpdateInput = Omit<
  UpdateHomepageBannerInput,
  "startsAt" | "endsAt" | "translations" | "removeDesktopVideo" | "removeMobileVideo"
> & HomepageVideoMetadata & {
  startsAt?: Date | null;
  endsAt?: Date | null;
  translations?: BannerTranslationsInput;
};

export interface HomepageStore {
  listAdmin(query: ListAdminBannersQuery): Promise<{ items: HomepageBannerRecord[]; total: number }>;
  findById(id: string): Promise<HomepageBannerRecord | null>;
  create(input: PersistedBannerCreateInput): Promise<HomepageBannerRecord>;
  update(id: string, input: PersistedBannerUpdateInput): Promise<HomepageBannerRecord | null>;
  delete(id: string): Promise<boolean>;
  toggleActive(id: string, isActive: boolean): Promise<HomepageBannerRecord | null>;
  listPublic(placement?: HomepageBannerPlacement, now?: Date): Promise<HomepageBannerRecord[]>;
}

export class HomepageRepository implements HomepageStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.client.$transaction(operation, { isolationLevel: "Serializable" });
      } catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  async listAdmin(query: ListAdminBannersQuery): Promise<{ items: HomepageBannerRecord[]; total: number }> {
    const where: Prisma.HomepageBannerWhereInput = {
      ...(query.placement ? { placement: query.placement } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              {
                translations: {
                  some: {
                    OR: [
                      { title: { contains: query.search, mode: "insensitive" } },
                      { subtitle: { contains: query.search, mode: "insensitive" } },
                      { description: { contains: query.search, mode: "insensitive" } },
                    ],
                  },
                },
              },
              { ctaUrl: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.client.$transaction([
      this.client.homepageBanner.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
        select: bannerSelect,
      }),
      this.client.homepageBanner.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string): Promise<HomepageBannerRecord | null> {
    return this.client.homepageBanner.findUnique({
      where: { id },
      select: bannerSelect,
    });
  }

  async create(input: PersistedBannerCreateInput): Promise<HomepageBannerRecord> {
    const { translations, ...bannerData } = input;
    try {
      return await this.serializable(async (tx) => {
        const created = await tx.homepageBanner.create({
          data: bannerData,
          select: { id: true },
        });

        if (translations) {
          for (const locale of ["ar", "en"] as const) {
            const fields = translations[locale];
            if (fields && fields.title) {
              const data = {
                title: fields.title,
                subtitle: fields.subtitle ?? null,
                description: fields.description ?? null,
                ctaLabel: fields.ctaLabel ?? null,
              };
              await tx.homepageBannerTranslation.upsert({
                where: { bannerId_locale: { bannerId: created.id, locale } },
                create: { bannerId: created.id, locale, ...data },
                update: data,
              });
            }
          }
        }

        return tx.homepageBanner.findUniqueOrThrow({
          where: { id: created.id },
          select: bannerSelect,
        });
      });
    } catch (error: unknown) {
      if (isCheckConstraintError(error)) throw new HomepageRepositoryError("INVALID_DATE_RANGE");
      throw error;
    }
  }

  async update(id: string, input: PersistedBannerUpdateInput): Promise<HomepageBannerRecord | null> {
    const { translations, ...bannerData } = input;
    try {
      return await this.serializable(async (tx) => {
        const existing = await tx.homepageBanner.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) return null;

        if (Object.keys(bannerData).length > 0) {
          await tx.homepageBanner.update({
            where: { id },
            data: bannerData,
          });
        }

        if (translations) {
          for (const locale of ["ar", "en"] as const) {
            const fields = translations[locale];
            if (fields) {
              const updateData: {
                title?: string;
                subtitle?: string | null;
                description?: string | null;
                ctaLabel?: string | null;
              } = {};
              if (fields.title !== undefined) updateData.title = fields.title;
              if (fields.subtitle !== undefined) updateData.subtitle = fields.subtitle;
              if (fields.description !== undefined) updateData.description = fields.description;
              if (fields.ctaLabel !== undefined) updateData.ctaLabel = fields.ctaLabel;

              if (Object.keys(updateData).length > 0) {
                await tx.homepageBannerTranslation.upsert({
                  where: { bannerId_locale: { bannerId: id, locale } },
                  create: {
                    bannerId: id,
                    locale,
                    title: updateData.title ?? "",
                    subtitle: updateData.subtitle ?? null,
                    description: updateData.description ?? null,
                    ctaLabel: updateData.ctaLabel ?? null,
                  },
                  update: updateData,
                });
              }
            }
          }
        }

        return tx.homepageBanner.findUniqueOrThrow({
          where: { id },
          select: bannerSelect,
        });
      });
    } catch (error: unknown) {
      if (isCheckConstraintError(error)) throw new HomepageRepositoryError("INVALID_DATE_RANGE");
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.client.homepageBanner.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async toggleActive(id: string, isActive: boolean): Promise<HomepageBannerRecord | null> {
    try {
      const banner = await this.client.homepageBanner.findUnique({ where: { id }, select: { endsAt: true } });
      const clearExpired = isActive && banner?.endsAt && banner.endsAt <= new Date();

      return await this.client.homepageBanner.update({
        where: { id },
        data: {
          isActive,
          ...(clearExpired ? { endsAt: null } : {}),
        },
        select: bannerSelect,
      });
    } catch {
      return null;
    }
  }

  async listPublic(placement?: HomepageBannerPlacement, now = new Date()): Promise<HomepageBannerRecord[]> {
    const where: Prisma.HomepageBannerWhereInput = {
      isActive: true,
      ...(placement ? { placement } : {}),
      AND: [
        {
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        },
        {
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      ],
    };

    return this.client.homepageBanner.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: bannerSelect,
    });
  }
}
