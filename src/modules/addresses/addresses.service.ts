import { AppError } from "../../common/errors/app-error";
import { toAddressDto } from "./addresses.dto";
import { AddressesRepository } from "./addresses.repository";
import type { CreateAddressInput, UpdateAddressInput } from "./addresses.validation";

export interface AddressesStore {
  listOwned: AddressesRepository["listOwned"];
  findOwned: AddressesRepository["findOwned"];
  createOwned: AddressesRepository["createOwned"];
  updateOwned: AddressesRepository["updateOwned"];
  setDefaultOwned: AddressesRepository["setDefaultOwned"];
  deleteOwned: AddressesRepository["deleteOwned"];
}

export class AddressesService {
  constructor(private readonly repository: AddressesStore = new AddressesRepository()) {}

  async list(userId: string) {
    return (await this.repository.listOwned(userId)).map(toAddressDto);
  }

  async get(userId: string, addressId: string) {
    const address = await this.repository.findOwned(userId, addressId);
    if (!address) throw new AppError(404, "Address not found", "ADDRESS_NOT_FOUND");
    return toAddressDto(address);
  }

  async create(userId: string, input: CreateAddressInput) {
    return toAddressDto(await this.repository.createOwned(userId, input));
  }

  async update(userId: string, addressId: string, input: UpdateAddressInput) {
    const address = await this.repository.updateOwned(userId, addressId, input);
    if (!address) throw new AppError(404, "Address not found", "ADDRESS_NOT_FOUND");
    return toAddressDto(address);
  }

  async setDefault(userId: string, addressId: string) {
    const address = await this.repository.setDefaultOwned(userId, addressId);
    if (!address) throw new AppError(404, "Address not found", "ADDRESS_NOT_FOUND");
    return toAddressDto(address);
  }

  async delete(userId: string, addressId: string): Promise<void> {
    if (!(await this.repository.deleteOwned(userId, addressId))) {
      throw new AppError(404, "Address not found", "ADDRESS_NOT_FOUND");
    }
  }
}
