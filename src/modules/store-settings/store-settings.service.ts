import { StoreSettingsRepository } from "./store-settings.repository";
import type { UpdateStoreSettingsInput } from "./store-settings.validation";

const defaults = { id: 1, storeName: "Shoozy", countryCode: "TN", currency: "TND", currencyMinorUnit: 3, whatsappNumber: null, supportPhone: null, supportEmail: null, shippingPolicy: null, returnWindowDays: 14, exchangeWindowDays: 14, whatsappConfirmationEnabled: false };
export class StoreSettingsService {
  constructor(private readonly repository = new StoreSettingsRepository()) {}
  async getPublic() {
    const value = await this.repository.get() ?? defaults;
    return { storeName: value.storeName, countryCode: value.countryCode, currency: value.currency, currencyMinorUnit: value.currencyMinorUnit, whatsappNumber: value.whatsappNumber, supportPhone: value.supportPhone, supportEmail: value.supportEmail, shippingPolicy: value.shippingPolicy, returnWindowDays: value.returnWindowDays, exchangeWindowDays: value.exchangeWindowDays, whatsappConfirmationEnabled: value.whatsappConfirmationEnabled };
  }
  async getAdmin() { return await this.repository.get() ?? defaults; }
  update(input: UpdateStoreSettingsInput, actorId?: string) { return this.repository.update(input, actorId); }
}
