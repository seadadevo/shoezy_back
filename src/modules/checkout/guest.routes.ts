import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import { commerceMutationRateLimit } from "../../common/middlewares/commerce-rate-limit.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ok } from "../../common/utils/api-response";
import { GuestCartsRoutes, requireGuestSession } from "../carts/guest-carts.routes";
import { CheckoutService } from "./checkout.service";
import { guestCheckoutPreviewSchema, guestCreateOrderSchema, type GuestCheckoutInput, type GuestCreateOrderInput } from "./guest-checkout.validation";
import { OrdersService } from "../orders/orders.service";
import { requireIdempotencyKey } from "../orders/orders.validation";

const router = Router();
const checkout = new CheckoutService();
const orders = new OrdersService();
router.use("/cart", GuestCartsRoutes);
router.post("/checkout/preview", validate(guestCheckoutPreviewSchema), requireGuestSession, commerceMutationRateLimit(60, "CHECKOUT_RATE_LIMITED"), async (request, response, next) => {
  try { response.json(ok(await checkout.previewGuest(request.guestSessionToken!, request.validated!.body as GuestCheckoutInput))); } catch (error: unknown) { next(error); }
});
router.post("/orders", validate(guestCreateOrderSchema), requireGuestSession, commerceMutationRateLimit(20, "ORDER_RATE_LIMITED"), requireIdempotencyKey, async (request, response, next) => {
  try {
    const result = await orders.placeGuest(request.guestSessionToken!, request.idempotencyKey!, request.validated!.body as GuestCreateOrderInput);
    response.status(result.idempotentReplay ? 200 : 201).json(ok(result));
  } catch (error: unknown) { next(error); }
});
const guestOrderLookupSchema = z.object({ body: z.preprocess((value) => value ?? {}, z.object({}).strict()), params: z.object({ orderNumber: z.string().regex(/^SHZ-[A-F0-9]{24}$/) }), query: z.object({}).strict() }).strict();
router.get("/orders/:orderNumber", validate(guestOrderLookupSchema), commerceMutationRateLimit(30, "GUEST_ORDER_LOOKUP_RATE_LIMITED"), async (request, response, next) => {
  try {
    const token = request.header("X-Guest-Order-Token");
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(401, "Guest order access token required", "GUEST_ORDER_TOKEN_INVALID");
    response.json(ok(await orders.getGuest((request.validated!.params as { orderNumber: string }).orderNumber, token)));
  } catch (error: unknown) { next(error); }
});
export const GuestRoutes = router;
