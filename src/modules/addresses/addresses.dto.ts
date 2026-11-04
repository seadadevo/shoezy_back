import type { AddressRecord } from "./addresses.types";

export function toAddressDto(address: AddressRecord) {
  return {
    id: address.id,
    type: address.type,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    countryCode: address.countryCode,
    state: address.state,
    city: address.city,
    area: address.area,
    postalCode: address.postalCode,
    line1: address.line1,
    line2: address.line2,
    latitude: address.latitude?.toString() ?? null,
    longitude: address.longitude?.toString() ?? null,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}
