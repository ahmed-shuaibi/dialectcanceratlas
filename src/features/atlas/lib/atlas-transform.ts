import {
  BMR_IDS,
  DEFAULT_MIN_IDENTIFIED_BMRS,
  DEFAULT_MIN_SIGNIFICANT_BMRS,
  DEFAULT_Q_THRESHOLD,
  Q_THRESHOLDS,
  type AtlasMode,
  type Bmr,
  type BmrCount,
  type CohortData,
  type DialectRow,
  type Direction,
  type InteractionResult,
  type ModelMatch,
  type PairEvidence,
  type PairSelection,
} from "@/features/atlas/types";

export const baseGene = (geneEffect: string) => geneEffect.replace(/_[MN]$/, "");

export function pairKey(ga: string, gb: string): string {
  return [ga, gb].sort().join("::");
}

/** Locale-independent ordinal ordering, matching the immutable release validator. */
export function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function resultId(direction: Direction, ga: string, gb: string): string {
  return `${direction}::${pairKey(ga, gb)}`;
}

export function parsePairId(value: string | undefined): PairSelection | null {
  if (!value) return null;
  const [direction, ga, gb, ...rest] = value.split("::");
  if (rest.length > 0 || (direction !== "ME" && direction !== "CO") || !ga || !gb) return null;
  return { direction, ga, gb };
}

export const isSameBaseGene = (row: Pick<DialectRow, "ga" | "gb">) =>
  baseGene(row.ga) === baseGene(row.gb);

/**
 * K=100 rows use strict `q < cutoff`. K=500 rows carry the release builder's exact
 * inclusive log-q decisions, so the site never re-derives a call from rounded q.
 */
export function isSignificant(
  row: Pick<DialectRow, "q" | "decisionBits">,
  qThreshold = DEFAULT_Q_THRESHOLD,
): boolean {
  if (row.decisionBits != null) {
    const bit = Q_THRESHOLDS.findIndex((threshold) => threshold === qThreshold);
    if (bit >= 0) return (row.decisionBits & (1 << bit)) !== 0;
    return row.q != null && row.q <= qThreshold;
  }
  return row.q != null && row.q < qThreshold;
}

/** Negative fitted LRT values carry zero evidence under the release contract. */
export const lrtEvidence = (row: Pick<DialectRow, "lrt">) => Math.max(0, row.lrt);

const isDirection = (row: DialectRow): row is DialectRow & { direction: Direction } =>
  row.direction === "ME" || row.direction === "CO";

type CohortIndexes = {
  byModel: Record<Bmr, Map<string, DialectRow>>;
  byPair: Record<Bmr, Map<string, DialectRow>>;
  denominators: Record<Bmr, Record<Direction, number>>;
  mutsigFallback: Set<string>;
};

const indexCache = new WeakMap<CohortData, CohortIndexes>();
const consensusCandidateCache = new WeakMap<
  CohortData,
  Partial<Record<Direction, InteractionResult[]>>
>();

function cohortIndexes(data: CohortData): CohortIndexes {
  const cached = indexCache.get(data);
  if (cached) return cached;
  const byModel = {} as Record<Bmr, Map<string, DialectRow>>;
  const byPair = {} as Record<Bmr, Map<string, DialectRow>>;
  const denominators = {} as Record<Bmr, Record<Direction, number>>;
  for (const bmr of BMR_IDS) {
    const map = new Map<string, DialectRow>();
    const pairMap = new Map<string, DialectRow>();
    const max: Record<Direction, number> = { ME: 1, CO: 1 };
    for (const row of data.models[bmr]) {
      const pair = pairKey(row.ga, row.gb);
      const pairPrior = pairMap.get(pair);
      if (!pairPrior || row.rank < pairPrior.rank) pairMap.set(pair, row);
      if (!isDirection(row)) continue;
      const id = resultId(row.direction, row.ga, row.gb);
      const prior = map.get(id);
      if (!prior || row.rank < prior.rank) map.set(id, row);
      max[row.direction] = Math.max(max[row.direction], row.rank);
    }
    byModel[bmr] = map;
    byPair[bmr] = pairMap;
    // K=500 materializes a subset; percentiles use the full-table direction totals.
    denominators[bmr] = data.directionTotals?.[bmr] ?? max;
  }
  const indexes = {
    byModel,
    byPair,
    denominators,
    mutsigFallback: new Set(data.mutsigCbaseFallbackFeatures),
  };
  indexCache.set(data, indexes);
  return indexes;
}

export function mutsigFallbackForPair(
  data: CohortData,
  ga: string,
  gb: string,
): string[] {
  const fallback = cohortIndexes(data).mutsigFallback;
  return [ga, gb].filter((feature) => fallback.has(feature));
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)] ?? 1;
}

function withoutMutsigFallback(
  matches: ModelMatch[],
  mutsigFallbackFeatures: string[],
): ModelMatch[] {
  if (mutsigFallbackFeatures.length === 0) return matches;
  return matches.filter(({ bmr }) => bmr !== "mutsig");
}

/** Return a pair row in the requested gene order, preserving A/B contingency semantics. */
export function orientDialectRow(row: DialectRow, ga: string, gb: string): DialectRow {
  if (row.ga === ga && row.gb === gb) return row;
  if (row.ga !== gb || row.gb !== ga) {
    throw new Error(`Cannot orient unrelated pair ${row.ga}::${row.gb} as ${ga}::${gb}`);
  }
  return {
    ...row,
    ga,
    gb,
    tau10: row.tau01,
    tau01: row.tau10,
    observedBOnly: row.observedAOnly,
    observedAOnly: row.observedBOnly,
    tau1x: row.taux1,
    taux1: row.tau1x,
  };
}

/** Any tested pair row, including K=500 rows outside the materialized candidate set. */
function pairRow(data: CohortData, bmr: Bmr, ga: string, gb: string): DialectRow | undefined {
  return cohortIndexes(data).byPair[bmr].get(pairKey(ga, gb)) ??
    data.lookupPair?.(bmr, ga, gb) ?? undefined;
}

function directionRow(
  data: CohortData,
  bmr: Bmr,
  direction: Direction,
  ga: string,
  gb: string,
): (DialectRow & { direction: Direction }) | undefined {
  const row = cohortIndexes(data).byModel[bmr].get(resultId(direction, ga, gb)) ??
    data.lookupPair?.(bmr, ga, gb) ?? undefined;
  return row && row.direction === direction ? row as DialectRow & { direction: Direction } : undefined;
}

function exactMatches(data: CohortData, row: DialectRow & { direction: Direction }): ModelMatch[] {
  const indexes = cohortIndexes(data);
  return BMR_IDS.flatMap((bmr) => {
    const match = directionRow(data, bmr, row.direction, row.ga, row.gb);
    if (!match) return [];
    return [
      {
        bmr,
        row: orientDialectRow(match, row.ga, row.gb),
        percentile: match.rank / indexes.denominators[bmr][row.direction],
      },
    ];
  });
}

function allPairEvidence(
  data: CohortData,
  row: Pick<DialectRow, "ga" | "gb">,
): PairEvidence[] {
  return BMR_IDS.flatMap((bmr) => {
    const evidence = pairRow(data, bmr, row.ga, row.gb);
    return evidence
      ? [{ bmr, row: orientDialectRow(evidence, row.ga, row.gb) }]
      : [];
  });
}

function toResult(
  data: CohortData,
  representative: DialectRow & { direction: Direction },
): InteractionResult {
  const matches = exactMatches(data, representative);
  const pairEvidence = allPairEvidence(data, representative);
  const mutsigFallbackFeatures = pairEvidence.some(({ bmr }) => bmr === "mutsig")
    ? mutsigFallbackForPair(data, representative.ga, representative.gb)
    : [];
  const percentiles = withoutMutsigFallback(matches, mutsigFallbackFeatures)
    .map((match) => match.percentile);
  return {
    id: resultId(representative.direction, representative.ga, representative.gb),
    ga: representative.ga,
    gb: representative.gb,
    direction: representative.direction,
    representative,
    matches,
    pairEvidence,
    mutsigFallbackFeatures,
    worstPercentile: percentiles.length ? Math.max(...percentiles) : 1,
    medianPercentile: median(percentiles),
  };
}

/** Same-direction BMR matches that contribute independent consensus evidence. */
export function independentConsensusMatches(result: InteractionResult): ModelMatch[] {
  return withoutMutsigFallback(result.matches, result.mutsigFallbackFeatures);
}

function compareConsensusRank(a: InteractionResult, b: InteractionResult): number {
  return (
    a.worstPercentile - b.worstPercentile ||
    a.medianPercentile - b.medianPercentile ||
    codePointCompare(a.id, b.id)
  );
}

/** Structural consensus candidates are cached; threshold changes only filter this set. */
function consensusCandidates(data: CohortData, direction: Direction): InteractionResult[] {
  let cached = consensusCandidateCache.get(data);
  if (!cached) {
    cached = {};
    consensusCandidateCache.set(data, cached);
  }
  const existing = cached[direction];
  if (existing) return existing;

  const indexes = cohortIndexes(data);
  const seen = new Set<string>();
  const results: InteractionResult[] = [];
  for (const bmr of BMR_IDS) {
    for (const row of indexes.byModel[bmr].values()) {
      if (row.direction !== direction || (!data.includeSameGenePairs && isSameBaseGene(row))) continue;
      const id = resultId(direction, row.ga, row.gb);
      if (seen.has(id)) continue;
      seen.add(id);
      const result = toResult(data, row as DialectRow & { direction: Direction });
      if (independentConsensusMatches(result).length > 0) results.push(result);
    }
  }
  results.sort(compareConsensusRank);
  cached[direction] = results;
  return results;
}

/**
 * Consensus requires configurable independent BMR counts for exact same-direction
 * identification and significance. Defaults preserve the strict three-BMR call.
 */
export type ResultFilter = {
  qThreshold?: number;
  significantOnly?: boolean;
  minIdentifiedBmrs?: BmrCount;
  minSignificantBmrs?: BmrCount;
};

export function consensusResults(
  data: CohortData,
  direction: Direction,
  {
    qThreshold = DEFAULT_Q_THRESHOLD,
    significantOnly = true,
    minIdentifiedBmrs = DEFAULT_MIN_IDENTIFIED_BMRS,
    minSignificantBmrs = DEFAULT_MIN_SIGNIFICANT_BMRS,
  }: ResultFilter = {},
): InteractionResult[] {
  return consensusCandidates(data, direction).filter((result) => {
    const support = backgroundSupport(result, qThreshold);
    return (
      support.identified >= minIdentifiedBmrs &&
      (!significantOnly || support.significant >= minSignificantBmrs)
    );
  });
}

export function modelResults(
  data: CohortData,
  bmr: Bmr,
  direction: Direction,
  { qThreshold = DEFAULT_Q_THRESHOLD, significantOnly = true }: ResultFilter = {},
): InteractionResult[] {
  const results = data.models[bmr]
    .filter((row): row is DialectRow & { direction: Direction } => isDirection(row))
    .filter(
      (row) =>
        row.direction === direction &&
        (data.includeSameGenePairs || !isSameBaseGene(row)) &&
        (!significantOnly || isSignificant(row, qThreshold)),
    )
    .map((row) => toResult(data, row));

  return results.sort(
    (a, b) =>
      a.representative.rank - b.representative.rank || codePointCompare(a.id, b.id),
  );
}

export function resultsForMode(
  data: CohortData,
  mode: AtlasMode,
  direction: Direction,
  filter: ResultFilter = {},
): InteractionResult[] {
  return mode === "consensus"
    ? consensusResults(data, direction, filter)
    : modelResults(data, mode, direction, filter);
}

/** The exact ranked candidate set shared by Explore's network and list renderers. */
export function exploreResults(
  data: CohortData,
  mode: AtlasMode,
  filter: ResultFilter = {},
): InteractionResult[] {
  return [
    ...resultsForMode(data, mode, "ME", filter),
    ...resultsForMode(data, mode, "CO", filter),
  ];
}

export function filterResultsByGene(
  results: InteractionResult[],
  query: string,
): InteractionResult[] {
  const needle = query.trim().toLocaleUpperCase("en-US");
  if (!needle) return results;
  return results.filter(
    ({ ga, gb }) =>
      ga.toLocaleUpperCase("en-US").includes(needle) ||
      gb.toLocaleUpperCase("en-US").includes(needle) ||
      baseGene(ga).toLocaleUpperCase("en-US").includes(needle) ||
      baseGene(gb).toLocaleUpperCase("en-US").includes(needle),
  );
}

/** The q-value that controls an interaction's visible significance encoding. */
export function resultQ(
  result: InteractionResult,
  mode: AtlasMode,
  minSignificantBmrs: BmrCount = DEFAULT_MIN_SIGNIFICANT_BMRS,
): number {
  if (mode !== "consensus") {
    return result.matches.find(({ bmr }) => bmr === mode)?.row.q ?? 1;
  }
  const ordered = independentConsensusMatches(result)
    .map(({ row }) => row.q ?? 1)
    .sort((a, b) => a - b);
  return ordered[minSignificantBmrs - 1] ?? 1;
}

/** The visible q label; K=500 rows carry Benjamini-Yekutieli q. */
export function resultQLabel(
  result: InteractionResult,
  mode: AtlasMode,
  minSignificantBmrs: BmrCount = DEFAULT_MIN_SIGNIFICANT_BMRS,
): string {
  const label = mode === "consensus" ? consensusQLabel(minSignificantBmrs) : "q";
  return result.representative.decisionBits != null ? `BY ${label}` : label;
}

export function consensusQLabel(minSignificantBmrs: BmrCount): string {
  if (minSignificantBmrs === 1) return "min q";
  if (minSignificantBmrs === BMR_IDS.length) return "max q";
  return "2nd q";
}

/** Independent background support after excluding any MutSigCV2 CBaSE fallback. */
export function backgroundSupport(
  result: InteractionResult,
  qThreshold = DEFAULT_Q_THRESHOLD,
): { identified: number; significant: number; independent: number } {
  const hasMutsigFallback = result.mutsigFallbackFeatures.length > 0;
  const matches = independentConsensusMatches(result);
  return {
    identified: matches.length,
    significant: matches.filter(({ row }) => isSignificant(row, qThreshold)).length,
    independent: BMR_IDS.length - (hasMutsigFallback ? 1 : 0),
  };
}

export function findResult(data: CohortData, selection: PairSelection): InteractionResult | null {
  for (const bmr of BMR_IDS) {
    const row = directionRow(data, bmr, selection.direction, selection.ga, selection.gb);
    if (row) return toResult(data, row);
  }
  return null;
}

export function findResultForMode(
  data: CohortData,
  selection: PairSelection,
  mode: AtlasMode,
  filter: ResultFilter = {},
): InteractionResult | null {
  if (mode === "consensus") {
    const result = findResult(data, selection);
    if (!result || (!data.includeSameGenePairs && isSameBaseGene(result))) return null;
    const {
      qThreshold = DEFAULT_Q_THRESHOLD,
      significantOnly = true,
      minIdentifiedBmrs = DEFAULT_MIN_IDENTIFIED_BMRS,
      minSignificantBmrs = DEFAULT_MIN_SIGNIFICANT_BMRS,
    } = filter;
    const support = backgroundSupport(result, qThreshold);
    if (support.identified < minIdentifiedBmrs) return null;
    if (significantOnly && support.significant < minSignificantBmrs) return null;
    return result;
  }
  const row = directionRow(data, mode, selection.direction, selection.ga, selection.gb);
  if (!row || (!data.includeSameGenePairs && isSameBaseGene(row))) return null;
  const { qThreshold = DEFAULT_Q_THRESHOLD, significantOnly = true } = filter;
  if (significantOnly && !isSignificant(row, qThreshold)) return null;
  return toResult(data, row);
}

export function resultIsSignificant(
  result: InteractionResult,
  mode: AtlasMode,
  {
    qThreshold = DEFAULT_Q_THRESHOLD,
    minIdentifiedBmrs = DEFAULT_MIN_IDENTIFIED_BMRS,
    minSignificantBmrs = DEFAULT_MIN_SIGNIFICANT_BMRS,
  }: Omit<ResultFilter, "significantOnly"> = {},
): boolean {
  if (mode === "consensus") {
    const support = backgroundSupport(result, qThreshold);
    return support.identified >= minIdentifiedBmrs && support.significant >= minSignificantBmrs;
  }
  const match = result.matches.find(({ bmr }) => bmr === mode);
  return match != null && isSignificant(match.row, qThreshold);
}

export const fmtInt = (value: number) => value.toLocaleString("en-US");
export const fmtStat = (value: number, digits = 3) => value.toFixed(digits);
export const fmtQ = (value: number | null) => {
  if (value == null) return "not reported";
  if (value < 0.0001) return value.toExponential(1);
  return value.toFixed(4);
};
