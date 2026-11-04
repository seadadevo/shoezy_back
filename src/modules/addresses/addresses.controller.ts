import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { AddressesService } from "./addresses.service";
import type { CreateAddressInput, UpdateAddressInput } from "./addresses.validation";

function context(request: Request) {
  if (!request.auth || !request.validated) {
    throw new AppError(500, "Request context is unavailable", "REQUEST_CONTEXT_MISSING");
  }
  return request.auth;
}

function addressId(request: Request): string {
  return (request.validated?.params as { addressId: string }).addressId;
}

export class AddressesController {
  constructor(private readonly service = new AddressesService()) {}

  list = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.list(context(request).userId))); } catch (error: unknown) { next(error); }
  };
  get = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.get(context(request).userId, addressId(request)))); } catch (error: unknown) { next(error); }
  };
  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.status(201).json(ok(await this.service.create(
        context(request).userId,
        request.validated?.body as CreateAddressInput,
      )));
    } catch (error: unknown) { next(error); }
  };
  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(ok(await this.service.update(
        context(request).userId,
        addressId(request),
        request.validated?.body as UpdateAddressInput,
      )));
    } catch (error: unknown) { next(error); }
  };
  setDefault = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.setDefault(context(request).userId, addressId(request)))); } catch (error: unknown) { next(error); }
  };
  delete = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.service.delete(context(request).userId, addressId(request));
      response.status(204).send();
    } catch (error: unknown) { next(error); }
  };
}
