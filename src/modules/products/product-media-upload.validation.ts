import { z } from "zod";
const empty = z.object({}).strict();
const formBoolean = z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean());
export const uploadProductMediaSchema = z.object({
  body: z.object({
    variantId: z.string().uuid().optional(),
    mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
    altText: z.string().trim().max(255).optional(),
    position: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
    isPrimary: formBoolean.optional(),
    replaceVideo: formBoolean.optional(),
  }).strict()
    .refine((data) => !(data.mediaType === "VIDEO" && data.isPrimary === true), {
      message: "Video media cannot be used as the product primary cover",
      path: ["isPrimary"],
    }),
  params: z.object({ productId: z.string().uuid() }).strict(),
  query: empty,
}).strict();
export type UploadProductMediaInput = z.infer<typeof uploadProductMediaSchema>["body"];
