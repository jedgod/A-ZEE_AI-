import { FEATURE_BYTES } from "./fingerprint";

type Hit = { qx: number; qy: number; sx: number; sy: number; error: number };
const BANDS = 4;
const BUCKETS = 65536;
const MAX_BUCKET_HITS = 192;
const MAX_DESCRIPTOR_ERRORS = 12;
const MAX_HITS_PER_SOURCE = 48;
const MAX_VERIFIED_CANDIDATES = 128;
const POPCOUNT = Uint8Array.from({ length: 256 }, (_, i) => i.toString(2).replace(/0/g, "").length);

function verifiedCount(hits: Hit[]) {
  let best = 0;
  hits.sort((a, b) => a.error - b.error);
  const anchors = hits.slice(0, 24);
  for (const [aIndex, a] of anchors.entries()) {
    for (const b of anchors.slice(aIndex + 1)) {
      const qx = b.qx - a.qx, qy = b.qy - a.qy;
      const sx = b.sx - a.sx, sy = b.sy - a.sy;
      const length = qx * qx + qy * qy;
      if (length < 24 * 24 || sx * sx + sy * sy < 24 * 24) continue;
      const scale = (qx * sx + qy * sy) / length;
      if (scale < 0.35 || scale > 2.85 || Math.hypot(sx - scale * qx, sy - scale * qy) > 5) continue;
      const dx = a.sx - scale * a.qx;
      const dy = a.sy - scale * a.qy;
      const accepted: Hit[] = [];
      for (const h of hits) {
        if (Math.hypot(h.sx - (scale * h.qx + dx), h.sy - (scale * h.qy + dy)) > 5) continue;
        if (accepted.some(p => Math.hypot(h.qx - p.qx, h.qy - p.qy) < 8 || Math.hypot(h.sx - p.sx, h.sy - p.sy) < 8)) continue;
        accepted.push(h);
      }
      if (accepted.length > best && accepted.length >= 5 &&
          Math.max(...accepted.map(p => p.qx)) - Math.min(...accepted.map(p => p.qx)) >= 20 &&
          Math.max(...accepted.map(p => p.qy)) - Math.min(...accepted.map(p => p.qy)) >= 20) best = accepted.length;
    }
  }
  return best;
}

export class LocalIndex {
  private readonly data: Buffer;
  private readonly source: Uint16Array;
  private readonly links: Int32Array[];
  private readonly heads: Int32Array[];
  private readonly sizes: Uint32Array[];

  constructor(entries: readonly { featuresV1?: string }[]) {
    const signatures = entries.map(entry => Buffer.from(entry.featuresV1 ?? "", "base64"));
    this.data = Buffer.concat(signatures);
    const count = this.data.length / FEATURE_BYTES;
    this.source = new Uint16Array(count);
    this.links = Array.from({ length: BANDS }, () => new Int32Array(count));
    this.heads = Array.from({ length: BANDS }, () => new Int32Array(BUCKETS));
    this.sizes = Array.from({ length: BANDS }, () => new Uint32Array(BUCKETS));
    let id = 0;
    for (const [source, signature] of signatures.entries()) {
      for (let p = 0; p < signature.length; p += FEATURE_BYTES, id++) {
        this.source[id] = source;
        for (let band = 0; band < BANDS; band++) {
          const key = signature.readUInt16LE(p + 3 + band * 2);
          this.links[band][id] = this.heads[band][key];
          this.heads[band][key] = id + 1;
          this.sizes[band][key]++;
        }
      }
    }
  }

  find(signature: string): Map<number, number> {
    const query = Buffer.from(signature, "base64");
    const candidates = new Map<number, Hit[]>();
    for (let q = 0; q < query.length; q += FEATURE_BYTES) {
      const visited = new Set<number>();
      for (let band = 0; band < BANDS; band++) {
        const key = query.readUInt16LE(q + 3 + band * 2);
        if (this.sizes[band][key] > MAX_BUCKET_HITS) continue;
        for (let id = this.heads[band][key] - 1; id >= 0; id = this.links[band][id] - 1) {
          if (visited.has(id)) continue;
          visited.add(id);
          const offset = id * FEATURE_BYTES;
          let error = 0;
          for (let k = 3; k < FEATURE_BYTES; k++) error += POPCOUNT[query[q + k] ^ this.data[offset + k]];
          if (error > MAX_DESCRIPTOR_ERRORS) continue;
          const source = this.source[id];
          const hits = candidates.get(source) ?? [];
          if (hits.length >= MAX_HITS_PER_SOURCE) continue;
          hits.push({ qx: query[q], qy: query[q + 1], sx: this.data[offset], sy: this.data[offset + 1], error });
          candidates.set(source, hits);
        }
      }
    }
    const verified = new Map<number, number>();
    const shortlist = [...candidates].filter(([, hits]) => hits.length >= 5)
      .sort((a, b) => b[1].length - a[1].length).slice(0, MAX_VERIFIED_CANDIDATES);
    for (const [source, hits] of shortlist) {
      const count = verifiedCount(hits);
      if (count >= 5) verified.set(source, count);
    }
    return verified;
  }
}
