import "server-only";
import { z } from "zod";
import { moduleSchema as baseModuleSchema, type Module as BaseModule } from "./contracts";

export const moduleSchema = baseModuleSchema;
export type Module = BaseModule;
export const idSchema = z.string().uuid();
export const revision = z.number().int().positive();
