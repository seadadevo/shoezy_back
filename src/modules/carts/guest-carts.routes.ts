import { Router, type RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import { commerceMutationRateLimit } from "../../common/middlewares/commerce-rate-limit.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ok } from "../../common/utils/api-response";
import { CartsService } from "./carts.service";
import { addCartItemSchema, deleteCartItemSchema, getCartSchema, setCartDiscountCodeSchema, updateCartItemSchema, type AddCartItemInput, type SetCartDiscountCodeInput, type UpdateCartItemInput } from "./carts.validation";

const service = new CartsService();
const router = Router();
const requireGuestSession: RequestHandler = async (request, _response, next) => {
  const token = request.header("X-Guest-Session");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return next(new AppError(401, "A valid guest session is required", "GUEST_SESSION_INVALID"));
  try { if (!await service.validGuestSession(token)) return next(new AppError(401, "Guest session has expired or is unavailable", "GUEST_SESSION_INVALID")); }
  catch (error: unknown) { return next(error); }
  request.guestSessionToken = token;
  next();
};
const owner = (token: string | undefined) => ({ sessionToken: token! });

router.post("/session", validate(getCartSchema), commerceMutationRateLimit(20, "GUEST_SESSION_RATE_LIMITED"), async (_request, response, next) => {
  try { response.status(201).json(ok({ sessionToken: await service.createGuestSession() })); } catch (error: unknown) { next(error); }
});
router.post("/items", validate(addCartItemSchema), commerceMutationRateLimit(60, "GUEST_CART_RATE_LIMITED"), async (request, response, next) => {
  try {
    const token = request.header("X-Guest-Session");
    if (!token) return response.status(201).json(ok(await service.addFirstGuestItem(request.validated!.body as AddCartItemInput)));
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !await service.validGuestSession(token)) throw new AppError(401, "A valid guest session is required", "GUEST_SESSION_INVALID");
    response.status(201).json(ok(await service.addItem(owner(token), request.validated!.body as AddCartItemInput)));
  } catch (error: unknown) { next(error); }
});
router.use(requireGuestSession);
router.get("/", validate(getCartSchema), async (request, response, next) => {
  try { response.json(ok(await service.get(owner(request.guestSessionToken)))); } catch (error: unknown) { next(error); }
});
router.patch("/items/:cartItemId", validate(updateCartItemSchema), async (request, response, next) => {
  try { response.json(ok(await service.updateItem(owner(request.guestSessionToken), (request.validated!.params as { cartItemId: string }).cartItemId, request.validated!.body as UpdateCartItemInput))); } catch (error: unknown) { next(error); }
});
router.delete("/items/:cartItemId", validate(deleteCartItemSchema), async (request, response, next) => {
  try { response.json(ok(await service.deleteItem(owner(request.guestSessionToken), (request.validated!.params as { cartItemId: string }).cartItemId))); } catch (error: unknown) { next(error); }
});
router.delete("/", validate(getCartSchema), async (request, response, next) => {
  try { await service.clear(owner(request.guestSessionToken)); response.status(204).send(); } catch (error: unknown) { next(error); }
});
router.put("/discount-code", validate(setCartDiscountCodeSchema), async (request, response, next) => {
  try { response.json(ok(await service.setDiscountCode(owner(request.guestSessionToken), request.validated!.body as SetCartDiscountCodeInput))); } catch (error: unknown) { next(error); }
});
router.delete("/discount-code", validate(getCartSchema), async (request, response, next) => {
  try { response.json(ok(await service.removeDiscountCode(owner(request.guestSessionToken)))); } catch (error: unknown) { next(error); }
});
export const GuestCartsRoutes = router;
export { requireGuestSession };
