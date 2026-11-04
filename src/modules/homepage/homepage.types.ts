import type { HomepageBannerPlacement as PrismaPlacement } from "@prisma/client";

export type HomepageBannerPlacement = PrismaPlacement;

export const HOMEPAGE_BANNER_PLACEMENTS: readonly HomepageBannerPlacement[] = [
  "HERO_SLIDER",
  "TOP_BAR",
  "MIDDLE_BANNER",
  "SIDE_BANNER",
  "PROMO_BANNER_1",
  "PROMO_BANNER_2",
] as const;

export interface HomepageBannerTranslationFields {
  [key: string]: unknown;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  ctaLabel?: string | null;
}

export type BannerTranslationsInput = {
  en?: HomepageBannerTranslationFields;
  ar?: HomepageBannerTranslationFields;
};

export interface HomepageBannerRecord {
  id: string;
  placement: HomepageBannerPlacement;
  ctaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  desktopVideoUrl: string | null;
  desktopVideoMimeType: string | null;
  desktopVideoStorageProvider: string | null;
  desktopVideoStorageKey: string | null;
  mobileVideoUrl: string | null;
  mobileVideoMimeType: string | null;
  mobileVideoStorageProvider: string | null;
  mobileVideoStorageKey: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  promotionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  translations: Array<{
    id: string;
    bannerId: string;
    locale: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    ctaLabel: string | null;
  }>;
  promotion?: {
    id: string;
    name: string;
    code: string | null;
    isActive: boolean;
  } | null;
}

export interface HomepageBannerAdminDto {
  id: string;
  placement: HomepageBannerPlacement;
  ctaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  desktopVideoUrl: string | null;
  desktopVideoMimeType: string | null;
  mobileVideoUrl: string | null;
  mobileVideoMimeType: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  promotionId: string | null;
  createdAt: string;
  updatedAt: string;
  translations: {
    en?: HomepageBannerTranslationFields;
    ar?: HomepageBannerTranslationFields;
  };
  promotion?: {
    id: string;
    name: string;
    code: string | null;
    isActive: boolean;
  } | null;
}

export interface HomepageBannerPublicDto {
  id: string;
  placement: HomepageBannerPlacement;
  title: string;
  subtitle: string | null;
  description: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  desktopVideoUrl: string | null;
  desktopVideoMimeType: string | null;
  mobileVideoUrl: string | null;
  mobileVideoMimeType: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  promotionId: string | null;
  promotion?: {
    id: string;
    name: string;
    code: string | null;
  } | null;
}
