// ============================================================
// 12_DELIVERY / UI_RENDER
// File: lib/operations/ui_render.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

// This module is implemented as a React component.
// See the page.tsx tab for the complete renderer.
// Keep rendering on the client, ownership checks on the server.

export function validateRenderableArtifact(raw: unknown) {
  return artifactSchema.parse(raw);
}

// Do not use dangerouslySetInnerHTML for generated output.
// If Markdown is added, disable raw HTML and sanitize links.
