import { z } from "zod";

export const missionSchema = z.object({
  id: z.literal("AZ_AI"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  purpose: z.string().min(20).max(1000),
  principles: z.array(z.string().min(5).max(300)).min(3).max(20),
  userRoute: z.literal("/"),
  adminRoute: z.literal("/admin"),
  prohibitedClaims: z.array(z.string().min(5)).min(1),
}).strict();

export const mission = Object.freeze(missionSchema.parse({
  id: "AZ_AI",
  version: "1.0.0",
  purpose:
    "Help people reason, learn, and build through a transparent AI workspace, "+
    "while keeping administrative control isolated from the user experience.",
  principles: Object.freeze([
    "User workspace and administrative control plane are separate experiences.",
    "Be explicit about uncertainty, provider failures, and unavailable tools.",
    "Use least privilege and enforce authorization on the server.",
    "Minimize stored personal data and honor tenant boundaries.",
    "Require independent approval for protected operations.",
  ]),
  userRoute: "/",
  adminRoute: "/admin",
  prohibitedClaims: Object.freeze([
    "Do not claim browsing when no search tool was invoked.",
    "Do not claim code execution when no isolated executor ran.",
    "Do not present invented citations as verified evidence.",
    "Do not claim a production deployment was tested without execution evidence.",
  ]),
}));
export type Mission = z.infer<typeof missionSchema>;

export function getProductIdentity() {
  return {
    name: mission.id,
    purpose: mission.purpose,
    userRoute: mission.userRoute,
  } as const;
}
