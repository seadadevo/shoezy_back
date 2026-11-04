export const SYSTEM_ROLES = {
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
} as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const CUSTOMER_PERMISSIONS = {
  PROFILE_READ_OWN: "profile.read.own",
  PROFILE_UPDATE_OWN: "profile.update.own",
  ADDRESSES_READ_OWN: "addresses.read.own",
  ADDRESSES_CREATE_OWN: "addresses.create.own",
  ADDRESSES_UPDATE_OWN: "addresses.update.own",
  ADDRESSES_DELETE_OWN: "addresses.delete.own",
  CART_READ_OWN: "cart.read.own",
  CART_MANAGE_OWN: "cart.manage.own",
  ORDERS_CREATE_OWN: "orders.create.own",
  ORDERS_READ_OWN: "orders.read.own",
  ORDERS_CANCEL_OWN: "orders.cancel.own",
  RETURNS_CREATE_OWN: "returns.create.own",
  RETURNS_READ_OWN: "returns.read.own",
  EXCHANGES_CREATE_OWN: "exchanges.create.own",
  EXCHANGES_READ_OWN: "exchanges.read.own",
  WISHLIST_READ_OWN: "wishlist.read.own",
  WISHLIST_MANAGE_OWN: "wishlist.manage.own",
  REVIEWS_CREATE_OWN: "reviews.create.own",
  REVIEWS_UPDATE_OWN: "reviews.update.own",
  REVIEWS_DELETE_OWN: "reviews.delete.own",
} as const;

export const ADMIN_PERMISSIONS = {
  AUDIT_LOGS_READ_ANY: "audit-logs.read.any",
  USERS_READ_ANY: "users.read.any",
  USERS_MANAGE_ANY: "users.manage.any",
  BRANDS_MANAGE_ANY: "brands.manage.any",
  CATEGORIES_MANAGE_ANY: "categories.manage.any",
  SIZE_GUIDES_MANAGE_ANY: "size-guides.manage.any",
  PRODUCTS_READ_ANY: "products.read.any",
  PRODUCTS_CREATE_ANY: "products.create.any",
  PRODUCTS_UPDATE_ANY: "products.update.any",
  PRODUCTS_DELETE_ANY: "products.delete.any",
  VARIANTS_MANAGE_ANY: "variants.manage.any",
  COLLECTIONS_MANAGE_ANY: "collections.manage.any",
  DISCOUNTS_MANAGE_ANY: "discounts.manage.any",
  ORDERS_READ_ANY: "orders.read.any",
  ORDERS_MANAGE_ANY: "orders.manage.any",
  SHIPPING_MANAGE_ANY: "shipping.manage.any",
  STORE_SETTINGS_MANAGE_ANY: "store-settings.manage.any",
  INVENTORY_READ_ANY: "inventory.read.any",
  EXCHANGES_READ_ANY: "exchanges.read.any",
  EXCHANGES_MANAGE_ANY: "exchanges.manage.any",
  RETURNS_READ_ANY: "returns.read.any",
  RETURNS_MANAGE_ANY: "returns.manage.any",
  REVIEWS_READ_ANY: "reviews.read.any",
  REVIEWS_MODERATE_ANY: "reviews.moderate.any",
  DASHBOARD_READ_ANY: "dashboard.read.any",
  HOMEPAGE_READ_ANY: "homepage.read.any",
  HOMEPAGE_MANAGE_ANY: "homepage.manage.any",
  RBAC_READ_ANY: "rbac.read.any",
  RBAC_MANAGE_ANY: "rbac.manage.any",
  SUPPORT_READ_ANY: "support.read.any",
  SUPPORT_MANAGE_ANY: "support.manage.any",
} as const;

export const PERMISSIONS = {
  ...CUSTOMER_PERMISSIONS,
  ...ADMIN_PERMISSIONS,
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const CUSTOMER_PERMISSION_CODES = Object.values(CUSTOMER_PERMISSIONS);
export const ALL_PERMISSION_CODES = Object.values(PERMISSIONS);

export const SYSTEM_ROLE_DEFINITIONS = {
  [SYSTEM_ROLES.CUSTOMER]: {
    name: "Customer",
    description: "Public customer account",
    permissions: CUSTOMER_PERMISSION_CODES,
  },
  [SYSTEM_ROLES.ADMIN]: {
    name: "Administrator",
    description: "Administrative account with every explicit catalog permission",
    permissions: ALL_PERMISSION_CODES,
  },
} as const satisfies Record<
  SystemRoleCode,
  { name: string; description: string; permissions: readonly PermissionCode[] }
>;
