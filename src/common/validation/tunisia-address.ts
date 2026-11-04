import { Prisma } from "@prisma/client";
import { z } from "zod";

function decimalCoordinate(minimum: string, maximum: string) {
  return z
    .string()
    .trim()
    .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,7})?$/, "Must be a finite decimal string")
    .refine((value) => {
      const decimal = new Prisma.Decimal(value);
      return decimal.greaterThanOrEqualTo(minimum) && decimal.lessThanOrEqualTo(maximum);
    }, `Must be between ${minimum} and ${maximum}`);
}

export const tunisiaCountryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value): boolean => value === "TN", "Delivery is available inside Tunisia only");

export const latitudeSchema = decimalCoordinate("-90", "90");
export const longitudeSchema = decimalCoordinate("-180", "180");
