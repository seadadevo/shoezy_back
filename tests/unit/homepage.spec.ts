import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { MediaStorage } from "../../src/modules/products/media-storage";
import { HomepageRepository, HomepageRepositoryError, type HomepageStore } from "../../src/modules/homepage/homepage.repository";
import { HomepageService, type HomepageUploadedFiles } from "../../src/modules/homepage/homepage.service";
import type {
  BannerTranslationsInput,
  HomepageBannerRecord,
  HomepageBannerTranslationFields,
} from "../../src/modules/homepage/homepage.types";
import { isValidCtaUrl } from "../../src/modules/homepage/homepage.validation";

const bannerId = "11111111-1111-4111-8111-111111111111";
const promotionId = "22222222-2222-4222-8222-222222222222";

function banner(overrides: Partial<HomepageBannerRecord> = {}): HomepageBannerRecord {
  return {
    id: bannerId,
    placement: "HERO_SLIDER",
    ctaUrl: "/products",
    desktopImageUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/desktop.jpg",
    mobileImageUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/mobile.jpg",
    desktopVideoUrl: null,
    desktopVideoMimeType: null,
    desktopVideoStorageProvider: null,
    desktopVideoStorageKey: null,
    mobileVideoUrl: null,
    mobileVideoMimeType: null,
    mobileVideoStorageProvider: null,
    mobileVideoStorageKey: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    promotionId: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    translations: [
      {
        id: "tr-en",
        bannerId,
        locale: "en",
        title: "Summer Collection",
        subtitle: "Luxury Footwear",
        description: "Curated styles",
        ctaLabel: "Shop Now",
      },
      {
        id: "tr-ar",
        bannerId,
        locale: "ar",
        title: "تشكيلة الصيف",
        subtitle: "أحذية فاخرة",
        description: "تصاميم مختارة",
        ctaLabel: "تسوق الآن",
      },
    ],
    promotion: null,
    ...overrides,
  };
}

function toTranslationRows(translations?: BannerTranslationsInput) {
  if (!translations) return banner().translations;
  return (Object.entries(translations) as [string, HomepageBannerTranslationFields | undefined][])
    .filter((entry): entry is [string, HomepageBannerTranslationFields] => Boolean(entry[1]))
    .map(([locale, fields]) => ({
      id: `tr-${locale}`,
      bannerId,
      locale,
      title: fields.title ?? "",
      subtitle: fields.subtitle ? String(fields.subtitle) : null,
      description: fields.description ? String(fields.description) : null,
      ctaLabel: fields.ctaLabel ? String(fields.ctaLabel) : null,
    }));
}

function mockStore(): HomepageStore {
  return {
    listAdmin: vi.fn(async () => ({ items: [banner()], total: 1 })),
    findById: vi.fn(async (id) => (id === bannerId ? banner() : null)),
    create: vi.fn(async (input) =>
      banner({
        ...input,
        id: bannerId,
        translations: toTranslationRows(input.translations),
      }),
    ),
    update: vi.fn(async (id, input) =>
      id === bannerId
        ? banner({
            ...input,
            translations: input.translations ? toTranslationRows(input.translations) : banner().translations,
          })
        : null,
    ),
    delete: vi.fn(async (id) => id === bannerId),
    toggleActive: vi.fn(async (id, isActive) => (id === bannerId ? banner({ isActive }) : null)),
    listPublic: vi.fn(async () => [banner()]),
  };
}

function mockStorage(configured = true): MediaStorage {
  return {
    isConfigured: vi.fn(() => configured),
    upload: vi.fn(async (file) => ({
      url: file.mimetype === "video/quicktime"
        ? "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mov"
        : file.mimetype === "video/mp4"
        ? "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mp4"
        : "https://res.cloudinary.com/shoozy/image/upload/v1/uploaded.jpg",
      key: (file.mimetype === "video/mp4" || file.mimetype === "video/quicktime") ? "shoozy/homepage/uploaded-video" : "shoozy/homepage/uploaded",
      provider: "CLOUDINARY" as const,
    })),
    delete: vi.fn(async () => {}),
  };
}

function mockPrisma(promotionExists = true): PrismaClient {
  return {
    discount: {
      findUnique: vi.fn(async ({ where: { id } }) =>
        promotionExists && id === promotionId
          ? { id: promotionId, name: "Summer Sale", code: "SUMMER", isActive: true }
          : null,
      ),
    },
  } as unknown as PrismaClient;
}

// Magic bytes helpers for testing valid/invalid images
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WEBP_HEADER = Buffer.from("RIFF1234WEBP", "ascii");
const MP4_HEADER = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
const MOV_HEADER = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0, 0x71, 0x74, 0x20, 0x20]);

function uploadFile(fieldname: string, buffer = MP4_HEADER, mimetype = "video/mp4", size = buffer.length): Express.Multer.File {
  return { buffer, mimetype, size, fieldname, originalname: `${fieldname}.mp4`, encoding: "7bit" } as Express.Multer.File;
}

describe("CTA URL Validation", () => {
  it("accepts safe internal relative paths", () => {
    expect(isValidCtaUrl("/products")).toBe(true);
    expect(isValidCtaUrl("/products?gender=MALE")).toBe(true);
    expect(isValidCtaUrl("/categories/running-shoes")).toBe(true);
    expect(isValidCtaUrl("/collections/summer-drop")).toBe(true);
  });

  it("accepts valid absolute HTTP and HTTPS URLs", () => {
    expect(isValidCtaUrl("https://example.com/shoes")).toBe(true);
    expect(isValidCtaUrl("http://example.com/shoes")).toBe(true);
  });

  it("rejects open-redirect and protocol-relative URLs", () => {
    expect(isValidCtaUrl("//evil.com")).toBe(false);
    expect(isValidCtaUrl("/\\evil.com")).toBe(false);
  });

  it("rejects dangerous URI schemes", () => {
    expect(isValidCtaUrl("javascript:alert(1)")).toBe(false);
    expect(isValidCtaUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidCtaUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects empty or excessively long URLs", () => {
    expect(isValidCtaUrl("")).toBe(false);
    expect(isValidCtaUrl("a".repeat(501))).toBe(false);
  });
});

describe("HomepageService - Admin Operations", () => {
  it("creates a homepage banner with English and Arabic translations", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const result = await service.create({
      placement: "HERO_SLIDER",
      ctaUrl: "/products",
      sortOrder: 1,
      isActive: true,
      translations: {
        en: { title: "New Season", subtitle: "Summer 2026", ctaLabel: "Shop" },
        ar: { title: "موسم جديد", subtitle: "صيف 2026", ctaLabel: "تسوق" },
      },
    });

    expect(result.id).toBe(bannerId);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "HERO_SLIDER",
        ctaUrl: "/products",
        sortOrder: 1,
        translations: expect.objectContaining({
          en: expect.objectContaining({ title: "New Season" }),
          ar: expect.objectContaining({ title: "موسم جديد" }),
        }),
      }),
    );
  });

  it("uploads desktop and mobile images via Cloudinary when files are provided", async () => {
    const store = mockStore();
    const storage = mockStorage(true);
    const service = new HomepageService(store, storage, mockPrisma());

    const files: HomepageUploadedFiles = {
      desktopImage: [
        {
          buffer: JPEG_HEADER,
          mimetype: "image/jpeg",
          size: JPEG_HEADER.length,
          fieldname: "desktopImage",
          originalname: "hero.jpg",
          encoding: "7bit",
        } as Express.Multer.File,
      ],
      mobileImage: [
        {
          buffer: PNG_HEADER,
          mimetype: "image/png",
          size: PNG_HEADER.length,
          fieldname: "mobileImage",
          originalname: "hero-mobile.png",
          encoding: "7bit",
        } as Express.Multer.File,
      ],
    };

    await service.create(
      {
        placement: "HERO_SLIDER",
        ctaUrl: "/products",
        sortOrder: 0,
        isActive: true,
        translations: { en: { title: "Title" } },
      },
      files,
    );

    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        desktopImageUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/uploaded.jpg",
        mobileImageUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/uploaded.jpg",
      }),
    );
  });

  it.each([
    ["desktop", { desktopVideo: [uploadFile("desktopVideo")] }, { desktopVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mp4", desktopVideoMimeType: "video/mp4" }],
    ["mobile", { mobileVideo: [uploadFile("mobileVideo")] }, { mobileVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mp4", mobileVideoMimeType: "video/mp4" }],
    ["desktop and mobile", { desktopVideo: [uploadFile("desktopVideo")], mobileVideo: [uploadFile("mobileVideo")] }, {
      desktopVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mp4",
      desktopVideoMimeType: "video/mp4",
      mobileVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mp4",
      mobileVideoMimeType: "video/mp4",
    }],
  ])("creates a banner with %s MP4 video", async (_label, files, expected) => {
    const store = mockStore();
    const storage = mockStorage();
    const service = new HomepageService(store, storage, mockPrisma());

    await service.create({
      placement: "HERO_SLIDER",
      sortOrder: 0,
      isActive: true,
      translations: { en: { title: "Animated Hero" } },
    }, files);

    expect(store.create).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: "video/mp4" }),
      { folder: "shoozy/homepage", resourceType: "video" },
    );
  });


  it("creates a banner with MOV video (video/quicktime)", async () => {
    const store = mockStore();
    const storage = mockStorage();
    const service = new HomepageService(store, storage, mockPrisma());

    const input = {
      placement: "HERO_SLIDER" as const,
      sortOrder: 0,
      isActive: true,
      translations: { en: { title: "Animated Hero MOV" } },
    };

    const result = await service.create(input, {
      desktopVideo: [uploadFile("desktopVideo", MOV_HEADER, "video/quicktime")],
    });

    expect(result).toMatchObject({
      desktopVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/uploaded.mov",
      desktopVideoMimeType: "video/quicktime",
    });
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: "video/quicktime" }),
      { folder: "shoozy/homepage", resourceType: "video" },
    );
  });

  it("rejects invalid and oversized homepage videos", async () => {
    const service = new HomepageService(mockStore(), mockStorage(), mockPrisma());
    const input = { placement: "HERO_SLIDER" as const, sortOrder: 0, isActive: true, translations: { en: { title: "Hero" } } };

    await expect(service.create(input, {
      desktopVideo: [uploadFile("desktopVideo", MP4_HEADER, "video/webm")],
    })).rejects.toMatchObject({ statusCode: 422, code: "MEDIA_FILE_INVALID" });
    await expect(service.create(input, {
      desktopVideo: [uploadFile("desktopVideo", JPEG_HEADER, "video/mp4")],
    })).rejects.toMatchObject({ statusCode: 422, code: "MEDIA_FILE_INVALID" });
    await expect(service.create(input, {
      mobileVideo: [uploadFile("mobileVideo", MP4_HEADER, "video/mp4", 50 * 1024 * 1024 + 1)],
    })).rejects.toMatchObject({ statusCode: 413, code: "MEDIA_VIDEO_TOO_LARGE" });
  });

  it("rejects invalid image files and mismatched MIME types", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const invalidFile: HomepageUploadedFiles = {
      desktopImage: [
        {
          buffer: Buffer.from("NOT_AN_IMAGE_CONTENT"),
          mimetype: "image/jpeg",
          size: 20,
          fieldname: "desktopImage",
          originalname: "fake.jpg",
          encoding: "7bit",
        } as Express.Multer.File,
      ],
    };

    await expect(
      service.create(
        {
          placement: "HERO_SLIDER",
          sortOrder: 0,
          isActive: true,
          translations: { en: { title: "Title" } },
        },
        invalidFile,
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "MEDIA_FILE_INVALID" });
  });

  it("rejects image files exceeding 8 MB", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const oversizedFile: HomepageUploadedFiles = {
      desktopImage: [
        {
          buffer: JPEG_HEADER,
          mimetype: "image/jpeg",
          size: 9 * 1024 * 1024,
          fieldname: "desktopImage",
          originalname: "huge.jpg",
          encoding: "7bit",
        } as Express.Multer.File,
      ],
    };

    await expect(
      service.create(
        {
          placement: "HERO_SLIDER",
          sortOrder: 0,
          isActive: true,
          translations: { en: { title: "Title" } },
        },
        oversizedFile,
      ),
    ).rejects.toMatchObject({ statusCode: 413, code: "MEDIA_FILE_TOO_LARGE" });
  });

  it("returns controlled 503 error if Cloudinary is not configured when uploading", async () => {
    const store = mockStore();
    const unconfiguredStorage = mockStorage(false);
    const service = new HomepageService(store, unconfiguredStorage, mockPrisma());

    const files: HomepageUploadedFiles = {
      desktopImage: [
        {
          buffer: WEBP_HEADER,
          mimetype: "image/webp",
          size: WEBP_HEADER.length,
          fieldname: "desktopImage",
          originalname: "hero.webp",
          encoding: "7bit",
        } as Express.Multer.File,
      ],
    };

    await expect(
      service.create(
        {
          placement: "HERO_SLIDER",
          sortOrder: 0,
          isActive: true,
          translations: { en: { title: "Title" } },
        },
        files,
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: "MEDIA_STORAGE_NOT_CONFIGURED" });
  });

  it("validates promotion existence and rejects missing promotionId", async () => {
    const store = mockStore();
    const prismaMissingPromo = mockPrisma(false);
    const service = new HomepageService(store, mockStorage(), prismaMissingPromo);

    await expect(
      service.create({
        placement: "HERO_SLIDER",
        sortOrder: 0,
        isActive: true,
        promotionId: "99999999-9999-4999-8999-999999999999",
        translations: { en: { title: "Promo Banner" } },
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: "PROMOTION_NOT_FOUND" });
  });

  it("validates date ordering and rejects endsAt <= startsAt", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    await expect(
      service.create({
        placement: "HERO_SLIDER",
        sortOrder: 0,
        isActive: true,
        startsAt: "2026-09-10T00:00:00.000Z",
        endsAt: "2026-09-09T00:00:00.000Z",
        translations: { en: { title: "Invalid Dates" } },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "HOMEPAGE_BANNER_DATE_RANGE_INVALID" });
  });

  it("maps database date CHECK constraint errors cleanly", async () => {
    const store = mockStore();
    vi.mocked(store.create).mockRejectedValue(new HomepageRepositoryError("INVALID_DATE_RANGE"));
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    await expect(
      service.create({
        placement: "HERO_SLIDER",
        sortOrder: 0,
        isActive: true,
        translations: { en: { title: "Test" } },
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "HOMEPAGE_BANNER_DATE_RANGE_INVALID" });
  });

  it("updates an existing banner and handles partial fields", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const result = await service.update(bannerId, {
      isActive: false,
      sortOrder: 5,
      translations: { en: { title: "Updated Title" } },
    });

    expect(result.id).toBe(bannerId);
    expect(store.update).toHaveBeenCalledWith(
      bannerId,
      expect.objectContaining({ isActive: false, sortOrder: 5 }),
    );
  });

  it("throws 404 when updating non-existent banner", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    await expect(
      service.update("00000000-0000-4000-8000-000000000000", { sortOrder: 2 }),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOMEPAGE_BANNER_NOT_FOUND" });
  });

  it("replaces desktop and mobile videos after the database update succeeds", async () => {
    const existing = banner({
      desktopVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/old-desktop.mp4",
      desktopVideoMimeType: "video/mp4",
      desktopVideoStorageProvider: "CLOUDINARY",
      desktopVideoStorageKey: "shoozy/homepage/old-desktop",
      mobileVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/old-mobile.mp4",
      mobileVideoMimeType: "video/mp4",
      mobileVideoStorageProvider: "CLOUDINARY",
      mobileVideoStorageKey: "shoozy/homepage/old-mobile",
    });
    const store = mockStore();
    vi.mocked(store.findById).mockResolvedValue(existing);
    vi.mocked(store.update).mockImplementation(async (_id, input) => banner({
      ...existing,
      ...input,
      translations: input.translations ? toTranslationRows(input.translations) : existing.translations,
    }));
    const storage = mockStorage();
    const service = new HomepageService(store, storage, mockPrisma());

    const result = await service.update(bannerId, { sortOrder: 2 }, {
      desktopVideo: [uploadFile("desktopVideo")],
      mobileVideo: [uploadFile("mobileVideo")],
    });

    expect(result).toMatchObject({ desktopVideoMimeType: "video/mp4", mobileVideoMimeType: "video/mp4" });
    expect(storage.delete).toHaveBeenCalledWith("shoozy/homepage/old-desktop", { resourceType: "video" });
    expect(storage.delete).toHaveBeenCalledWith("shoozy/homepage/old-mobile", { resourceType: "video" });
    expect(vi.mocked(store.update).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(storage.delete).mock.invocationCallOrder[0]!);
  });

  it("cleans a new video and preserves the old video when the database update fails", async () => {
    const oldKey = "shoozy/homepage/old-desktop";
    const store = mockStore();
    vi.mocked(store.findById).mockResolvedValue(banner({
      desktopVideoUrl: "https://res.cloudinary.com/shoozy/video/upload/v1/old-desktop.mp4",
      desktopVideoMimeType: "video/mp4",
      desktopVideoStorageProvider: "CLOUDINARY",
      desktopVideoStorageKey: oldKey,
    }));
    vi.mocked(store.update).mockRejectedValue(new Error("database unavailable"));
    const storage = mockStorage();
    const service = new HomepageService(store, storage, mockPrisma());

    await expect(service.update(bannerId, { sortOrder: 3 }, {
      desktopVideo: [uploadFile("desktopVideo")],
    })).rejects.toThrow("database unavailable");

    expect(storage.delete).toHaveBeenCalledWith("shoozy/homepage/uploaded-video", { resourceType: "video" });
    expect(storage.delete).not.toHaveBeenCalledWith(oldKey, { resourceType: "video" });
  });

  it("removes desktop and mobile videos independently and clears all metadata", async () => {
    const existing = banner({
      desktopVideoUrl: "desktop.mp4", desktopVideoMimeType: "video/mp4", desktopVideoStorageProvider: "LOCAL", desktopVideoStorageKey: "homepage/desktop.mp4",
      mobileVideoUrl: "mobile.mp4", mobileVideoMimeType: "video/mp4", mobileVideoStorageProvider: "LOCAL", mobileVideoStorageKey: "homepage/mobile.mp4",
    });
    const store = mockStore();
    vi.mocked(store.findById).mockResolvedValue(existing);
    vi.mocked(store.update).mockImplementation(async (_id, input) => banner({
      ...existing,
      ...input,
      translations: input.translations ? toTranslationRows(input.translations) : existing.translations,
    }));
    const storage = mockStorage();
    const service = new HomepageService(store, storage, mockPrisma());

    const result = await service.update(bannerId, { removeDesktopVideo: true, removeMobileVideo: true });

    expect(result).toMatchObject({ desktopVideoUrl: null, desktopVideoMimeType: null, mobileVideoUrl: null, mobileVideoMimeType: null });
    expect(store.update).toHaveBeenCalledWith(bannerId, expect.objectContaining({
      desktopVideoStorageProvider: null, desktopVideoStorageKey: null,
      mobileVideoStorageProvider: null, mobileVideoStorageKey: null,
    }));
    expect(storage.delete).toHaveBeenCalledWith("homepage/desktop.mp4", { resourceType: "video" });
    expect(storage.delete).toHaveBeenCalledWith("homepage/mobile.mp4", { resourceType: "video" });
  });

  it("deletes a banner and returns void", async () => {
    const store = mockStore();
    vi.mocked(store.findById).mockResolvedValue(banner({
      desktopVideoUrl: "desktop.mp4", desktopVideoMimeType: "video/mp4", desktopVideoStorageProvider: "LOCAL", desktopVideoStorageKey: "homepage/desktop.mp4",
      mobileVideoUrl: "mobile.mp4", mobileVideoMimeType: "video/mp4", mobileVideoStorageProvider: "LOCAL", mobileVideoStorageKey: "homepage/mobile.mp4",
    }));
    const storage = mockStorage();
    const service = new HomepageService(store, storage, mockPrisma());

    await service.delete(bannerId);
    expect(store.delete).toHaveBeenCalledWith(bannerId);
    expect(storage.delete).toHaveBeenCalledWith("homepage/desktop.mp4", { resourceType: "video" });
    expect(storage.delete).toHaveBeenCalledWith("homepage/mobile.mp4", { resourceType: "video" });
  });

  it("throws 404 when deleting non-existent banner", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    await expect(
      service.delete("00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ statusCode: 404, code: "HOMEPAGE_BANNER_NOT_FOUND" });
  });

  it("toggles active status with toggleActive", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const result = await service.toggleActive(bannerId, false);
    expect(result.isActive).toBe(false);
    expect(store.toggleActive).toHaveBeenCalledWith(bannerId, false);
  });
});

describe("HomepageService - Public API & Localization", () => {
  it("exposes safe video fields without storage metadata", async () => {
    const store = mockStore();
    vi.mocked(store.listPublic).mockResolvedValue([banner({
      desktopVideoUrl: "https://cdn.example.com/desktop.mp4",
      desktopVideoMimeType: "video/mp4",
      desktopVideoStorageProvider: "LOCAL",
      desktopVideoStorageKey: "homepage/desktop.mp4",
      mobileVideoUrl: "https://cdn.example.com/mobile.mp4",
      mobileVideoMimeType: "video/mp4",
      mobileVideoStorageProvider: "LOCAL",
      mobileVideoStorageKey: "homepage/mobile.mp4",
    })]);

    const result = await new HomepageService(store, mockStorage(), mockPrisma()).listPublic("HERO_SLIDER", "en");

    expect(result[0]).toMatchObject({
      desktopVideoUrl: "https://cdn.example.com/desktop.mp4",
      desktopVideoMimeType: "video/mp4",
      mobileVideoUrl: "https://cdn.example.com/mobile.mp4",
      mobileVideoMimeType: "video/mp4",
      isActive: true,
    });
    expect(JSON.stringify(result)).not.toContain("StorageProvider");
    expect(JSON.stringify(result)).not.toContain("StorageKey");
  });

  it("returns localized Arabic content when Arabic is requested", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const banners = await service.listPublic("HERO_SLIDER", "ar");
    expect(banners).toHaveLength(1);
    expect(banners[0].title).toBe("تشكيلة الصيف");
    expect(banners[0].subtitle).toBe("أحذية فاخرة");
    expect(banners[0].ctaLabel).toBe("تسوق الآن");
    expect(banners[0].ctaUrl).toBe("/products");
  });

  it("falls back to English when requested Arabic field is missing", async () => {
    const bannerWithPartialArabic = banner({
      translations: [
        {
          id: "tr-en",
          bannerId,
          locale: "en",
          title: "Exclusive Summer",
          subtitle: "English Subtitle",
          description: "English Description",
          ctaLabel: "Shop Now",
        },
        {
          id: "tr-ar",
          bannerId,
          locale: "ar",
          title: "صيف حصري",
          subtitle: null, // missing Arabic subtitle
          description: null, // missing Arabic description
          ctaLabel: null, // missing Arabic CTA
        },
      ],
    });

    const store = mockStore();
    vi.mocked(store.listPublic).mockResolvedValue([bannerWithPartialArabic]);
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    const banners = await service.listPublic("HERO_SLIDER", "ar");
    expect(banners[0].title).toBe("صيف حصري"); // localized Arabic
    expect(banners[0].subtitle).toBe("English Subtitle"); // fell back to English
    expect(banners[0].description).toBe("English Description"); // fell back to English
    expect(banners[0].ctaLabel).toBe("Shop Now"); // fell back to English
  });

  it("passes placement filter and current date to repository", async () => {
    const store = mockStore();
    const service = new HomepageService(store, mockStorage(), mockPrisma());

    await service.listPublic("TOP_BAR", "en");
    expect(store.listPublic).toHaveBeenCalledWith("TOP_BAR", expect.any(Date));
  });

  it("preserves active and scheduling filters in the single public banner query", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new HomepageRepository({ homepageBanner: { findMany } } as unknown as PrismaClient);
    const now = new Date("2026-10-04T12:00:00.000Z");

    await repository.listPublic("HERO_SLIDER", now);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        isActive: true,
        placement: "HERO_SLIDER",
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }));
  });
});
