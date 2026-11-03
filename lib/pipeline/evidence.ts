import "server-only";
import { z } from "zod";
import { runConfidenceTags } from "@/09_GENERATION/confidence_tags/module";
import { runFactualCheck } from "@/10_VALIDATION/factual_check/module";
import { runHallucinationCheck } from "@/10_VALIDATION/hallucination_check/module";
import { generateValidated, type EvidenceVerifier, type ModelAdapter } from "@/lib/reliability/contracts";
import type { RetrievedSource } from "./context";

export type EvidenceReport = {
  tag: "unassessed" | "conflicting_evidence" | "partial_evidence" | "supported_by_checked_sources";
  assessedClaims: number; supported: number; contradicted: number; unknown: number;
};

const MAX_CLAIMS = 3;
const SOURCE_CHARS = 4000;

/**
 * 10_VALIDATION factual + hallucination checks and 09_GENERATION confidence tags, for answers that
 * used retrieved sources. Claims are extracted from the answer, then each is judged only against
 * the sources it cites (EvidenceVerifier). Model judgment is not proof; the tag is a signal.
 */
export async function checkEvidence(answer: string, sources: RetrievedSource[], model: ModelAdapter): Promise<EvidenceReport> {
  const ids = sources.map(s => s.sourceId);
  const extracted = await generateValidated(
    model,
    `List up to ${MAX_CLAIMS} factual claims in the answer that rely on the provided sources. For each claim, give the IDs of the sources it relies on, chosen only from sourceIds. Return {"claims":[{"claim":"...","sourceIds":["..."]}]}; return {"claims":[]} if none.`,
    { answer: answer.slice(0, 20000), sourceIds: ids },
    z.object({ claims: z.array(z.object({ claim: z.string().min(1).max(2000), sourceIds: z.array(z.string().max(200)).max(10) }).strict()).max(10) }).strict(),
  );
  const claims = extracted.claims
    .map(c => ({ claim: c.claim, sourceIds: [...new Set(c.sourceIds.filter(id => ids.includes(id)))] }))
    .filter(c => c.sourceIds.length)
    .slice(0, MAX_CLAIMS);
  if (!claims.length) return { tag: "unassessed", assessedClaims: 0, supported: 0, contradicted: 0, unknown: 0 };

  const verifier: EvidenceVerifier = {
    async check(claim, sourceIds) {
      const cited = sources.filter(s => sourceIds.includes(s.sourceId)).map(s => ({ id: s.sourceId, text: s.text.slice(0, SOURCE_CHARS) }));
      const judged = await generateValidated(
        model,
        'Judge whether the sources support or contradict the claim, using only the sources. Return {"status":"supported"|"contradicted"|"unknown","checkedSourceIds":[...]}.',
        { claim, sources: cited },
        z.object({ status: z.enum(["supported", "contradicted", "unknown"]), checkedSourceIds: z.array(z.string().max(200)).max(10) }).strict(),
      );
      const checked = judged.checkedSourceIds.filter(id => sourceIds.includes(id));
      return { status: judged.status, checkedSourceIds: checked.length || judged.status === "unknown" ? checked : [...sourceIds] };
    },
  };

  const { results } = await runFactualCheck(claims, verifier);
  const statuses = results.map(r => r.status);
  const summary = runHallucinationCheck(statuses);
  return {
    tag: runConfidenceTags(statuses).tag,
    assessedClaims: summary.assessedClaims, supported: summary.supported, contradicted: summary.contradicted, unknown: summary.unknown,
  };
}
