import { DataContractError } from "@/features/atlas/lib/decode";
import {
  BMR_IDS,
  Q_THRESHOLDS,
  type BaselineRow,
  type Bmr,
  type CohortData,
  type CohortMeta,
  type DialectRow,
  type Direction,
  type TransportDirection,
} from "@/features/atlas/types";

/** Rows materialized per background and direction even when not significant. */
export const RANKED_PER_DIRECTION = 250;
/**
 * Upper bound on rows materialized per background, direction, and baseline test.
 * Hypermutated cohorts reject >100k CO pairs under CBaSE/DIG; materializing all of
 * them costs hundreds of MB. Exact counts always come from the columnar arrays.
 */
export const MATERIALIZED_CAP = 2000;
const LARGEST_Q_BIT = 1 << (Q_THRESHOLDS.length - 1);
const MEGSA_P_CUTOFF = 0.001;

type Dtype = "float64" | "uint32" | "uint16" | "uint8";
type Column = Float64Array | Uint32Array | Uint16Array | Uint8Array;
export type ColumnTable = Record<string, Column>;

export interface ColumnRecord {
  name: string;
  dtype: Dtype;
  offset: number;
}

export interface TableRecord {
  file: string;
  rows: number;
  columns: ColumnRecord[];
  bytes: number;
  sha256: string;
  raw_bytes: number;
  raw_sha256: string;
}

export interface ColumnarCohortFile {
  id: string;
  k: number;
  n_samples: number;
  features: string[];
  drivers: string[];
  pair_policy: { tested_pairs: number; same_gene_pairs_included?: boolean };
  enums: { direction: string[]; identifiability: string[] };
  decision_thresholds: number[];
  tables: Record<"pairs" | "baselines", TableRecord> & Partial<Record<Bmr, TableRecord>>;
  summaries: {
    models: Record<Bmr, { directions: Record<string, number> }>;
  };
}

const VIEWS: Record<Dtype, { size: number; make: (buffer: ArrayBuffer, offset: number, rows: number) => Column }> = {
  float64: { size: 8, make: (buffer, offset, rows) => new Float64Array(buffer, offset, rows) },
  uint32: { size: 4, make: (buffer, offset, rows) => new Uint32Array(buffer, offset, rows) },
  uint16: { size: 2, make: (buffer, offset, rows) => new Uint16Array(buffer, offset, rows) },
  uint8: { size: 1, make: (buffer, offset, rows) => new Uint8Array(buffer, offset, rows) },
};

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Decode one aligned little-endian columnar table into zero-copy typed-array views. */
export function parseColumnTable(
  buffer: ArrayBuffer,
  record: TableRecord,
  required: readonly string[],
  label: string,
): ColumnTable {
  if (!LITTLE_ENDIAN) throw new DataContractError("K=500 tables require a little-endian platform");
  if (buffer.byteLength !== record.raw_bytes) {
    throw new DataContractError(`${label}: ${buffer.byteLength} bytes, expected ${record.raw_bytes}`);
  }
  const table: ColumnTable = {};
  let end = 0;
  for (const column of record.columns) {
    const view = VIEWS[column.dtype];
    if (!view || column.offset % view.size !== 0 || column.offset !== end) {
      throw new DataContractError(`${label}: invalid layout for column ${column.name}`);
    }
    end = column.offset + view.size * record.rows;
    if (end > buffer.byteLength) throw new DataContractError(`${label}: column ${column.name} overruns`);
    table[column.name] = view.make(buffer, column.offset, record.rows);
  }
  if (end !== buffer.byteLength) throw new DataContractError(`${label}: unaccounted table bytes`);
  const missing = required.filter((name) => !(name in table));
  if (missing.length > 0) throw new DataContractError(`${label}: missing columns ${missing.join(", ")}`);
  return table;
}

/** Gunzip when the bytes are gzip; pass through when the host already decoded them. */
export async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer;
  const stream = new Response(buffer).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

const MODEL_COLUMNS = [
  "lrt", "p", "by_q", "bh_q", "rho", "tau00", "tau10", "tau01", "tau11",
  "log_odds_ratio", "wald", "rank", "direction", "identifiability", "by_decisions",
] as const;
const PAIR_COLUMNS = [
  "a", "b", "observed_both", "observed_a_only", "observed_b_only", "observed_neither",
] as const;
const BASELINE_COLUMNS = [
  "fisher_me_p", "fisher_co_p", "fisher_me_q", "fisher_co_q",
  "discover_me_p", "discover_co_p", "discover_me_q", "discover_co_q",
  "megsa_lrt", "megsa_p", "megsa_q", "wesme_p", "wesco_p", "wesme_q", "wesco_q",
] as const;

const nullable = (value: number): number | null => (Number.isNaN(value) ? null : value);

function transportDirection(label: string | undefined): TransportDirection {
  if (label === "ME" || label === "CO" || label === "neutral" || label === "unavailable") return label;
  throw new DataContractError(`unknown direction label ${String(label)}`);
}

/** Build lazily materialized CohortData over the decoded K=500 tables. */
export function decodeColumnarCohort(
  meta: CohortMeta,
  cohort: ColumnarCohortFile,
  buffers: Record<string, ArrayBuffer>,
): CohortData {
  if (cohort.id !== meta.id) throw new DataContractError(`Cohort mismatch: index ${meta.id}, file ${cohort.id}`);
  if (
    cohort.decision_thresholds.length !== Q_THRESHOLDS.length ||
    cohort.decision_thresholds.some((value, index) => value !== Q_THRESHOLDS[index])
  ) {
    throw new DataContractError(`${cohort.id}: decision thresholds differ from the site q cutoffs`);
  }
  const rows = cohort.pair_policy.tested_pairs;
  const features = cohort.features;
  const width = features.length;
  const table = (name: "pairs" | Bmr | "baselines", required: readonly string[]) => {
    const buffer = buffers[name];
    if (!buffer) throw new DataContractError(`${cohort.id}: missing ${name} table`);
    const record = cohort.tables[name];
    if (!record) throw new DataContractError(`${cohort.id}: missing ${name} record`);
    const parsed = parseColumnTable(buffer, record, required, `${cohort.id}/${name}`);
    if (record.rows !== rows) throw new DataContractError(`${cohort.id}/${name}: row count drift`);
    return parsed;
  };
  const pairs = table("pairs", PAIR_COLUMNS);
  const availableBmrs = BMR_IDS.filter((bmr) => cohort.tables[bmr] != null);
  const models = Object.fromEntries(availableBmrs.map((bmr) => [bmr, table(bmr, MODEL_COLUMNS)])) as Record<Bmr, ColumnTable>;
  const baselines = table("baselines", BASELINE_COLUMNS);

  const featureIndex = new Map(features.map((feature, index) => [feature, index]));
  // Dense (a, b) -> row index; -1 marks same-base or untested pairs.
  const pairIndex = new Int32Array(width * width).fill(-1);
  for (let row = 0; row < rows; row += 1) pairIndex[pairs.a[row] * width + pairs.b[row]] = row;
  const rowFor = (ga: string, gb: string): number | undefined => {
    const a = featureIndex.get(ga);
    const b = featureIndex.get(gb);
    if (a == null || b == null || a === b) return undefined;
    const row = pairIndex[Math.min(a, b) * width + Math.max(a, b)];
    return row < 0 ? undefined : row;
  };

  const caches = Object.fromEntries(BMR_IDS.map((bmr) => [bmr, new Map<number, DialectRow>()])) as Record<Bmr, Map<number, DialectRow>>;
  const directionLabels = cohort.enums.direction;
  const identifiability = cohort.enums.identifiability;
  const rowAt = (bmr: Bmr, row: number): DialectRow => {
    const cached = caches[bmr].get(row);
    if (cached) return cached;
    const m = models[bmr];
    const tau00 = m.tau00[row];
    const tau10 = m.tau10[row];
    const tau01 = m.tau01[row];
    const tau11 = m.tau11[row];
    const value: DialectRow = {
      ga: features[pairs.a[row]],
      gb: features[pairs.b[row]],
      tau00,
      tau10,
      tau01,
      tau11,
      observedBoth: pairs.observed_both[row],
      observedBOnly: pairs.observed_b_only[row],
      observedAOnly: pairs.observed_a_only[row],
      observedNeither: pairs.observed_neither[row],
      tau1x: tau10 + tau11,
      taux1: tau01 + tau11,
      rho: nullable(m.rho[row]),
      logOddsRatio: nullable(m.log_odds_ratio[row]),
      lrt: m.lrt[row],
      wald: nullable(m.wald[row]),
      p: m.p[row],
      q: m.by_q[row],
      direction: transportDirection(directionLabels[m.direction[row]]),
      rank: m.rank[row],
      tauMass: tau00 + tau10 + tau01 + tau11,
      effectiveN: cohort.n_samples,
      excludedSamples: 0,
      decisionBits: m.by_decisions[row],
      bhQ: m.bh_q[row],
      identifiability: identifiability[m.identifiability[row]],
    };
    caches[bmr].set(row, value);
    return value;
  };

  const directionCode = (direction: Direction) => directionLabels.indexOf(direction);
  const bitFor = (qThreshold: number) => {
    const index = Q_THRESHOLDS.findIndex((threshold) => threshold === qThreshold);
    return index < 0 ? LARGEST_Q_BIT : 1 << index;
  };
  /** Exact directional row count, optionally restricted to calls at a q cutoff. */
  const countDirectional = (bmr: Bmr, direction: Direction, qThreshold: number | null) => {
    if (!availableBmrs.includes(bmr)) return 0;
    const m = models[bmr];
    const code = directionCode(direction);
    const bit = qThreshold == null ? 0 : bitFor(qThreshold);
    let total = 0;
    for (let row = 0; row < rows; row += 1) {
      if (m.direction[row] === code && (bit === 0 || (m.by_decisions[row] & bit) !== 0)) total += 1;
    }
    return total;
  };

  // Ranks order each direction by BY q first, so calls at the largest cutoff are
  // exactly ranks 1..S. Materialize that head (at least the ranked head), capped.
  const materializedPerDirection = {} as Record<Bmr, Record<Direction, number>>;
  const materialized = Object.fromEntries(BMR_IDS.map((bmr) => {
    if (!availableBmrs.includes(bmr)) {
      materializedPerDirection[bmr] = { ME: 0, CO: 0 };
      return [bmr, []];
    }
    const m = models[bmr];
    const limits = {
      ME: Math.min(MATERIALIZED_CAP, Math.max(RANKED_PER_DIRECTION, countDirectional(bmr, "ME", Q_THRESHOLDS[Q_THRESHOLDS.length - 1]))),
      CO: Math.min(MATERIALIZED_CAP, Math.max(RANKED_PER_DIRECTION, countDirectional(bmr, "CO", Q_THRESHOLDS[Q_THRESHOLDS.length - 1]))),
    };
    const codes = { ME: directionCode("ME"), CO: directionCode("CO") };
    const selected: DialectRow[] = [];
    for (let row = 0; row < rows; row += 1) {
      const rank = m.rank[row];
      if (rank === 0) continue;
      const code = m.direction[row];
      if ((code === codes.ME && rank <= limits.ME) || (code === codes.CO && rank <= limits.CO)) {
        selected.push(rowAt(bmr, row));
      }
    }
    materializedPerDirection[bmr] = {
      ME: Math.min(limits.ME, countDirectional(bmr, "ME", null)),
      CO: Math.min(limits.CO, countDirectional(bmr, "CO", null)),
    };
    return [bmr, selected];
  })) as Record<Bmr, DialectRow[]>;

  const largestQ = Q_THRESHOLDS[Q_THRESHOLDS.length - 1];
  const baselineAt = (row: number): BaselineRow => ({
    ga: features[pairs.a[row]],
    gb: features[pairs.b[row]],
    fisherMeP: baselines.fisher_me_p[row],
    fisherCoP: baselines.fisher_co_p[row],
    fisherMeQ: baselines.fisher_me_q[row],
    fisherCoQ: baselines.fisher_co_q[row],
    discoverMeP: baselines.discover_me_p[row],
    discoverCoP: baselines.discover_co_p[row],
    discoverMeQ: baselines.discover_me_q[row],
    discoverCoQ: baselines.discover_co_q[row],
    megsaScore: baselines.megsa_lrt[row],
    megsaP: baselines.megsa_p[row],
    megsaQ: baselines.megsa_q[row],
    wesmeP: baselines.wesme_p[row],
    wescoP: baselines.wesco_p[row],
    wesmeQ: baselines.wesme_q[row],
    wescoQ: baselines.wesco_q[row],
  });
  // Per baseline test and direction: the strongest calls within the largest cutoff.
  const baselineCriteria: Array<{ direction: Direction; column: Column; cutoff: number }> = [
    { direction: "ME", column: baselines.fisher_me_q, cutoff: largestQ },
    { direction: "CO", column: baselines.fisher_co_q, cutoff: largestQ },
    { direction: "ME", column: baselines.discover_me_q, cutoff: largestQ },
    { direction: "CO", column: baselines.discover_co_q, cutoff: largestQ },
    { direction: "ME", column: baselines.megsa_p, cutoff: MEGSA_P_CUTOFF },
    { direction: "ME", column: baselines.wesme_q, cutoff: largestQ },
    { direction: "CO", column: baselines.wesco_q, cutoff: largestQ },
  ];
  const baselineSelected = new Set<number>();
  let baselineTruncated = false;
  for (const { column, cutoff } of baselineCriteria) {
    const passing: number[] = [];
    for (let row = 0; row < rows; row += 1) if (column[row] < cutoff) passing.push(row);
    if (passing.length > MATERIALIZED_CAP) {
      baselineTruncated = true;
      passing.sort((a, b) => column[a] - column[b] || a - b);
    }
    for (const row of passing.slice(0, MATERIALIZED_CAP)) baselineSelected.add(row);
  }
  const baselineRows = [...baselineSelected].sort((a, b) => a - b).map(baselineAt);

  /** Exact count of pairs any displayed Compare method calls in a direction. */
  const countSupported = (direction: Direction, qThreshold: number) => {
    const code = directionCode(direction);
    const bit = bitFor(qThreshold);
    const criteria = baselineCriteria
      .filter((criterion) => criterion.direction === direction)
      .map(({ column, cutoff }) => ({ column, cutoff: cutoff === largestQ ? qThreshold : cutoff }));
    let total = 0;
    for (let row = 0; row < rows; row += 1) {
      const called =
        availableBmrs.some((bmr) => models[bmr].direction[row] === code && (models[bmr].by_decisions[row] & bit) !== 0) ||
        criteria.some(({ column, cutoff }) => column[row] < cutoff);
      // Count each tested pair once, including same-gene M:N pairs when present.
      if (called) total += 1;
    }
    return total;
  };

  const directionTotals = Object.fromEntries(BMR_IDS.map((bmr) => {
    const directions = cohort.summaries.models[bmr]?.directions ?? {};
    return [bmr, { ME: directions.ME ?? 0, CO: directions.CO ?? 0 } satisfies Record<Direction, number>];
  })) as Record<Bmr, Record<Direction, number>>;

  return {
    includeSameGenePairs: cohort.pair_policy.same_gene_pairs_included === true,
    id: cohort.id,
    drivers: cohort.drivers,
    models: materialized,
    baselines: baselineRows,
    mutsigCbaseFallbackFeatures: [],
    k: cohort.k,
    testedPairs: rows,
    rankedPerDirection: RANKED_PER_DIRECTION,
    materializedPerDirection,
    baselineTruncated,
    countDirectional,
    countSupported,
    directionTotals,
    lookupPair: (bmr, ga, gb) => {
      const row = rowFor(ga, gb);
      return row == null || !availableBmrs.includes(bmr) ? null : rowAt(bmr, row);
    },
    lookupBaseline: (ga, gb) => {
      const row = rowFor(ga, gb);
      return row == null ? null : baselineAt(row);
    },
  };
}

const TABLE_NAMES = ["pairs", ...BMR_IDS, "baselines"] as const;
const DTYPES = new Set<string>(["float64", "uint32", "uint16", "uint8"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DataContractError(`${label} must be a string array`);
  }
  return value as string[];
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DataContractError(`${label} must be a non-negative integer`);
  }
  return value;
}

/** Validate the K=500 cohort.json contract before any table is fetched. */
export function decodeColumnarCohortFile(value: unknown): ColumnarCohortFile {
  if (!isRecord(value)) throw new DataContractError("cohort must be an object");
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) throw new DataContractError("cohort.id must be a string");
  const label = `cohort ${id}`;
  const features = stringList(value.features, `${label}.features`);
  if (new Set(features).size !== features.length) throw new DataContractError(`${label}: duplicate features`);
  const policy = value.pair_policy;
  const enums = value.enums;
  const tables = value.tables;
  const summaries = value.summaries;
  if (!isRecord(policy) || !isRecord(enums) || !isRecord(tables) || !isRecord(summaries) || !isRecord(summaries.models)) {
    throw new DataContractError(`${label}: missing pair_policy, enums, tables, or summaries`);
  }
  const decodedTables = Object.fromEntries(TABLE_NAMES.filter((name) => name === "pairs" || name === "baselines" || name in tables).map((name) => {
    const record = tables[name];
    if (!isRecord(record) || typeof record.file !== "string" || !Array.isArray(record.columns)) {
      throw new DataContractError(`${label}.tables.${name} is invalid`);
    }
    const columns = record.columns.map((column, index) => {
      if (!isRecord(column) || typeof column.name !== "string" || !DTYPES.has(String(column.dtype))) {
        throw new DataContractError(`${label}.tables.${name}.columns[${index}] is invalid`);
      }
      return { name: column.name, dtype: column.dtype as Dtype, offset: count(column.offset, `${label}.${name}.offset`) };
    });
    return [name, {
      file: record.file,
      rows: count(record.rows, `${label}.tables.${name}.rows`),
      columns,
      bytes: count(record.bytes, `${label}.tables.${name}.bytes`),
      sha256: String(record.sha256),
      raw_bytes: count(record.raw_bytes, `${label}.tables.${name}.raw_bytes`),
      raw_sha256: String(record.raw_sha256),
    } satisfies TableRecord];
  })) as ColumnarCohortFile["tables"];
  const models = summaries.models;
  if (!BMR_IDS.some((bmr) => bmr in tables)) throw new DataContractError(`${label}: no backgrounds`);
  for (const bmr of BMR_IDS.filter((name) => name in tables)) {
    const summary = models[bmr];
    if (!isRecord(summary) || !isRecord(summary.directions)) {
      throw new DataContractError(`${label}.summaries.models.${bmr} is invalid`);
    }
  }
  return {
    id,
    k: count(value.k, `${label}.k`),
    n_samples: count(value.n_samples, `${label}.n_samples`),
    features,
    drivers: stringList(value.drivers ?? [], `${label}.drivers`),
    pair_policy: { tested_pairs: count(policy.tested_pairs, `${label}.pair_policy.tested_pairs`), same_gene_pairs_included: policy.same_gene_pairs_included === true },
    enums: {
      direction: stringList(enums.direction, `${label}.enums.direction`),
      identifiability: stringList(enums.identifiability, `${label}.enums.identifiability`),
    },
    decision_thresholds: Array.isArray(value.decision_thresholds)
      ? value.decision_thresholds.map(Number)
      : [],
    tables: decodedTables,
    summaries: summaries as unknown as ColumnarCohortFile["summaries"],
  };
}
