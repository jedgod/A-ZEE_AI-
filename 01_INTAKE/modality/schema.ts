// ============================================================
// 01_INTAKE / MODALITY / VALIDATION
// File: lib/intake/modality.ts
// Dependency: zod
// ============================================================

import { z } from "zod";

export const modalitySchema = z.object({
  kind: z.enum(["text", "image", "audio", "document"]),
  attachmentIds: z.array(z.string().uuid()).max(10),
}).strict().superRefine((value, ctx) => {
  if (value.kind !== "text" && !value.attachmentIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["attachmentIds"],
      message: "This modality requires an attachment",
    });
  }
});

// Verify ownership, MIME signatures, byte size,
// malware-scan status, and provider capability server-side.

export type ModalityInput =
  z.infer<typeof modalitySchema>;
