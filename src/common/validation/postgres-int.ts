import { z } from "zod";

export const POSTGRES_INT_MAX = 2_147_483_647;

export const nonnegativePostgresInt = z.number().int().min(0).max(POSTGRES_INT_MAX);
