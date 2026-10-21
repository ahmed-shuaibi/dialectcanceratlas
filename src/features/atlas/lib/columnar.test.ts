import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAtlasCache, loadCohort } from "@/features/atlas/lib/atlas-data";
import {
  exploreResults,
  findResult,
  isSignificant,
} from "@/features/atlas/lib/atlas-transform";
import {
  MATERIALIZED_CAP,
  RANKED_PER_DIRECTION,
  decodeColumnarCohort,
  decodeColumnarCohortFile,
  gunzipIfNeeded,
} from "@/features/atlas/lib/columnar";
import type { CohortMeta } from "@/features/atlas/types";

type Dtype = "float64" | "uint32" | "uint16" | "uint8";
const SIZE: Record<Dtype, number> = { float64: 8, uint32: 4, uint16: 2, uint8: 1 };
const ARRAY = {
  float64: Float64Array,
  uint32: Uint32Array,
  uint16: Uint16Array,
  uint8: Uint8Array,
} as const;
const ORDER: Dtype[] = ["float64", "uint32", "uint16", "uint8"];

/** Pack columns exactly like analysis/build_atlas_data_k500.encode_table. */
function encode(columns: Array<[string, Dtype, number[]]>, rows: number) {
  const ordered = [...columns].sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1]));
  const bytes = ordered.reduce((total, [, dtype]) => total + SIZE[dtype] * rows, 0);
  const buffer = new ArrayBuffer(bytes);
  let offset = 0;
  const layout = ordered.map(([name, dtype, values]) => {
    new ARRAY[dtype](buffer, offset, rows).set(values);
    const record = { name, dtype, offset };
    offset += SIZE[dtype] * rows;
    return record;
  });
  return { buffer, layout };
}

// Features A_M, B_M, C_N: pairs (A,B), (A,C), (B,C) in canonical a<b order.
const FEATURES = ["A_M", "B_M", "C_N"];
const ROWS = 3;
const log = Math.log;

function modelTable(q: number[], direction: number[], rho: number[], rank: number[], bits: number[]) {
  const float = (name: string, values: number[]): [string, Dtype, number[]] => [name, "float64", values];
  return encode([
    float("lrt", [12, 0.5, 9]),
    float("log_p", [log(1e-4), log(0.5), log(1e-3)]),
    float("p", [1e-4, 0.5, 1e-3]),
    float("log_by_q", q.map(log)),
    float("by_q", q),
    float("log_bh_q", q.map((value) => log(value / 2))),
    float("bh_q", q.map((value) => value / 2)),
    float("rho", rho),
    ...["tau00", "tau10", "tau01", "tau11"].map((name) => float(name, [0.4, 0.3, 0.2, 0.1].slice(0, 3))),
    float("log_odds_ratio", [-1, Number.NaN, 1]),
    float("wald", [2, Number.NaN, 2]),
    float("null_log_likelihood", [0, 0, 0]),
    float("alt_log_likelihood", [0, 0, 0]),
    ["rank", "uint32", rank],
    ["fit_iterations", "uint32", [10, 10, 10]],
    ["direction", "uint8", direction],
    ["identifiability", "uint8", [0, 1, 0]],
    ["effect_reportable", "uint8", [1, 0, 1]],
    ["fit_converged", "uint8", [1, 1, 1]],
    ["by_decisions", "uint8", bits],
    ["bh_decisions", "uint8", bits],
  ], ROWS);
}

function fixture() {
  const pairs = encode([
    ["a", "uint16", [0, 0, 1]],
    ["b", "uint16", [1, 2, 2]],
    ["observed_both", "uint16", [0, 1, 5]],
    ["observed_a_only", "uint16", [4, 3, 1]],
    ["observed_b_only", "uint16", [5, 2, 1]],
    ["observed_neither", "uint16", [1, 4, 3]],
  ], ROWS);
  // direction enum: 0 unavailable, 1 ME, 2 CO. A/B is ME with q exactly 0.01.
  const mutsig = modelTable([0.01, 1, 0.004], [1, 0, 2], [-0.5, Number.NaN, 0.4], [1, 0, 1], [0b1100, 0, 0b1110]);
  const baselines = encode(
    [
      "fisher_me_p", "fisher_co_p", "fisher_me_q", "fisher_co_q",
      "discover_me_p", "discover_co_p", "discover_me_q", "discover_co_q",
      "megsa_lrt", "megsa_p", "megsa_q", "wesme_p", "wesco_p", "wesme_q", "wesco_q",
    ].map((name): [string, Dtype, number[]] => [name, "float64", [0.001, 0.9, 0.9]]),
    ROWS,
  );
  const tables = { pairs, mutsig, cbase: mutsig, dig: mutsig, baselines };
  const files: Record<string, ArrayBuffer> = {};
  const records = Object.fromEntries(Object.entries(tables).map(([name, table]) => {
    const file = `${name}.bin.gz`;
    const gz = gzipSync(new Uint8Array(table.buffer));
    files[file] = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
    return [name, {
      file,
      rows: ROWS,
      columns: table.layout,
      bytes: gz.byteLength,
      sha256: "0".repeat(64),
      raw_bytes: table.buffer.byteLength,
      raw_sha256: "0".repeat(64),
    }];
  }));
  const directions = { unavailable: 1, ME: 1, CO: 1, neutral: 0 };
  const cohort = {
    id: "TCGA__TEST",
    study: "TCGA",
    cohort: "TEST",
    k: 3,
    n_samples: 10,
    features: FEATURES,
    drivers: [],
    pair_policy: { tested_pairs: ROWS },
    enums: {
      direction: ["unavailable", "ME", "CO", "neutral"],
      identifiability: ["full-affine-rank", "rank-deficient"],
    },
    decision_thresholds: [0.001, 0.005, 0.01, 0.05],
    tables: records,
    summaries: {
      models: Object.fromEntries(["mutsig", "cbase", "dig"].map((bmr) => [bmr, { directions }])),
    },
  };
  return { cohort, files };
}

const meta: CohortMeta = {
  id: "TCGA__TEST",
  study: "TCGA",
  cohort: "TEST",
  cancer: "Test",
  n_samples: 10,
  median_mutations: 1,
  cbio: "",
  k: 500,
  data_file: "cohorts/TCGA__TEST/cohort.json",
  data_sha256: "0".repeat(64),
  data_bytes: 1,
};

function stubFetch() {
  const { cohort, files } = fixture();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url).toContain("/data/releases/k500-2026-09-25/cohorts/TCGA__TEST/");
    if (url.endsWith("cohort.json")) return new Response(JSON.stringify(cohort), { status: 200 });
    const name = url.slice(url.lastIndexOf("/") + 1);
    return new Response(files[name], { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearAtlasCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("K=500 columnar cohorts", () => {
  it("decodes gzip tables into rows with exact inclusive decisions", async () => {
    const fetchMock = stubFetch();
    const data = await loadCohort(meta, "k500-2026-09-25");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(data.k).toBe(3);
    expect(data.testedPairs).toBe(3);
    expect(data.rankedPerDirection).toBe(RANKED_PER_DIRECTION);

    const me = data.lookupPair?.("mutsig", "B_M", "A_M");
    expect(me).toMatchObject({
      ga: "A_M",
      gb: "B_M",
      direction: "ME",
      q: 0.01,
      rho: -0.5,
      observedAOnly: 4,
      observedBOnly: 5,
      identifiability: "full-affine-rank",
    });
    // q = 0.01 is a call at the inclusive 0.01 cutoff and not at 0.005.
    expect(isSignificant(me!, 0.01)).toBe(true);
    expect(isSignificant(me!, 0.005)).toBe(false);

    const unavailable = data.lookupPair?.("mutsig", "A_M", "C_N");
    expect(unavailable).toMatchObject({ direction: "unavailable", rho: null, rank: 0 });
    expect(data.lookupBaseline?.("C_N", "B_M")).toMatchObject({ ga: "B_M", gb: "C_N" });
    expect(data.lookupPair?.("mutsig", "A_M", "A_M")).toBeNull();
  });

  it("keeps direction-unavailable rows out of ME/CO lists but reachable for detail", async () => {
    stubFetch();
    const data = await loadCohort(meta, "k500-2026-09-25");
    const results = exploreResults(data, "mutsig", { qThreshold: 0.01, significantOnly: true });
    expect(results.map(({ id }) => id)).toEqual(["ME::A_M::B_M", "CO::B_M::C_N"]);
    expect(findResult(data, { direction: "CO", ga: "B_M", gb: "C_N" })?.matches).toHaveLength(3);
    expect(findResult(data, { direction: "ME", ga: "A_M", gb: "C_N" })).toBeNull();
  });

  it("counts calls exactly from the columnar arrays", async () => {
    stubFetch();
    const data = await loadCohort(meta, "k500-2026-09-25");
    expect(data.countDirectional?.("mutsig", "ME", 0.01)).toBe(1);
    expect(data.countDirectional?.("mutsig", "CO", 0.005)).toBe(1);
    expect(data.countDirectional?.("mutsig", "CO", 0.001)).toBe(0);
    expect(data.countDirectional?.("mutsig", "ME", null)).toBe(1);
    // ME: A/B by every background and baseline. CO: B/C by DIALECT, A/B by baselines.
    expect(data.countSupported?.("ME", 0.01)).toBe(1);
    expect(data.countSupported?.("CO", 0.01)).toBe(2);
    // Baselines keep strict q < cutoff: 0.001 is not a call at 0.001.
    expect(data.countSupported?.("CO", 0.001)).toBe(0);
  });

  it("materializes a capped ranked head while exact totals stay complete", () => {
    const width = 73; // 2,628 pairs, all CO calls under every background.
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < width; i += 1) for (let j = i + 1; j < width; j += 1) { a.push(i); b.push(j); }
    const n = a.length;
    const fill = (value: number) => Array.from({ length: n }, () => value);
    const ranks = Array.from({ length: n }, (_, index) => index + 1);
    const model = encode([
      ...["lrt", "log_p", "p", "log_by_q", "by_q", "log_bh_q", "bh_q", "rho", "tau00", "tau10", "tau01", "tau11", "log_odds_ratio", "wald"]
        .map((name): [string, Dtype, number[]] => [name, "float64", fill(name === "rho" ? 0.5 : 0.001)]),
      ["rank", "uint32", ranks],
      ["direction", "uint8", fill(2)],
      ["identifiability", "uint8", fill(0)],
      ["by_decisions", "uint8", fill(0b1111)],
    ], n);
    const pairs = encode([
      ["a", "uint16", a], ["b", "uint16", b],
      ...["observed_both", "observed_a_only", "observed_b_only", "observed_neither"]
        .map((name): [string, Dtype, number[]] => [name, "uint16", fill(1)]),
    ], n);
    const baselines = encode(
      ["fisher_me_p", "fisher_co_p", "fisher_me_q", "fisher_co_q", "discover_me_p", "discover_co_p",
        "discover_me_q", "discover_co_q", "megsa_lrt", "megsa_p", "megsa_q", "wesme_p", "wesco_p",
        "wesme_q", "wesco_q"].map((name): [string, Dtype, number[]] => [name, "float64", fill(name === "fisher_co_q" ? 0.001 : 0.9)]),
      n,
    );
    const tables = { pairs, mutsig: model, cbase: model, dig: model, baselines };
    const record = (name: string, table: ReturnType<typeof encode>) => ({
      file: `${name}.bin.gz`, rows: n, columns: table.layout, bytes: 1, sha256: "", raw_bytes: table.buffer.byteLength, raw_sha256: "",
    });
    const directions = { unavailable: 0, ME: 0, CO: n, neutral: 0 };
    const cohort = decodeColumnarCohortFile({
      id: "TCGA__BIG", k: width, n_samples: 100,
      features: Array.from({ length: width }, (_, index) => `G${index}_M`),
      drivers: [],
      pair_policy: { tested_pairs: n },
      enums: { direction: ["unavailable", "ME", "CO", "neutral"], identifiability: ["full-affine-rank"] },
      decision_thresholds: [0.001, 0.005, 0.01, 0.05],
      tables: Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, record(name, table)])),
      summaries: { models: Object.fromEntries(["mutsig", "cbase", "dig"].map((bmr) => [bmr, { directions }])) },
    });
    const data = decodeColumnarCohort(
      { ...meta, id: "TCGA__BIG" },
      cohort,
      Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.buffer])),
    );
    expect(n).toBeGreaterThan(MATERIALIZED_CAP);
    expect(data.models.cbase).toHaveLength(MATERIALIZED_CAP);
    expect(data.models.cbase.at(-1)?.rank).toBe(MATERIALIZED_CAP);
    expect(data.materializedPerDirection?.cbase).toEqual({ ME: 0, CO: MATERIALIZED_CAP });
    expect(data.baselines).toHaveLength(MATERIALIZED_CAP);
    expect(data.baselineTruncated).toBe(true);
    expect(data.countDirectional?.("cbase", "CO", 0.01)).toBe(n);
    expect(data.countSupported?.("CO", 0.01)).toBe(n);
    // Rows past the cap stay reachable for pair detail.
    expect(data.lookupPair?.("cbase", "G71_M", "G72_M")?.rank).toBe(n);
  });

  it("passes through bytes the host already decompressed", async () => {
    const raw = new Uint8Array([1, 2, 3]).buffer;
    expect(await gunzipIfNeeded(raw)).toBe(raw);
  });
});


describe("final manuscript release", () => {
  it("loads only completed backgrounds and retains same-gene M:N pairs", async () => {
    const { cohort, files } = fixture();
    delete cohort.tables.cbase;
    delete cohort.tables.dig;
    cohort.features = ["A_M", "A_N", "C_N"];
    const input = { ...cohort, pair_policy: { ...cohort.pair_policy, same_gene_pairs_included: true } };
    const decoded = decodeColumnarCohortFile(input);
    const buffers: Record<string, ArrayBuffer> = {};
    for (const [name, record] of Object.entries(decoded.tables)) {
      buffers[name] = await gunzipIfNeeded(files[record!.file]);
    }
    const data = decodeColumnarCohort(meta, decoded, buffers);
    expect(data.models.cbase).toEqual([]);
    expect(data.lookupPair?.("cbase", "A_M", "A_N")).toBeNull();
    expect(data.countDirectional?.("mutsig", "ME", 0.05)).toBe(1);
    expect(exploreResults(data, "mutsig", { qThreshold: 0.05, significantOnly: true }).map((r) => [r.ga,r.gb])).toContainEqual(["A_M","A_N"]);
  });
});
