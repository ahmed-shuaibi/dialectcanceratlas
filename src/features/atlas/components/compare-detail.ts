import {
  baseGene,
  codePointCompare,
  findResult,
  isSignificant,
  pairKey,
} from "@/features/atlas/lib/atlas-transform";
import {
  BMR_METHODS,
  COMPARISON_METHODS,
  bmrMethodsFor,
  type BaselineMethodId,
} from "@/features/atlas/lib/atlas-metadata";
import {
  BMR_IDS,
  DEFAULT_Q_THRESHOLD,
  type BaselineRow,
  type Bmr,
  type CohortData,
  type DialectRow,
  type Direction,
  type InteractionResult,
  type ReleaseCatalogEntry,
  type ReleaseManifest,
} from "@/features/atlas/types";

export type CompareMethodId = Bmr | BaselineMethodId;
export type CompareSortDirection = "ascending" | "descending";

export type CompareMethod = {
  id: CompareMethodId;
  label: string;
  measure: "q" | "p";
  threshold: number;
  href: string;
};

export type CompareEvidence = {
  method: CompareMethod;
  tested: boolean;
  value: number | null;
  /** The method's own call at the active cutoff, irrespective of direction. */
  significant: boolean;
  supported: boolean;
  assignedDirection?: DialectRow["direction"];
  fallback?: boolean;
};

export type ComparisonRow = {
  id: string;
  ga: string;
  gb: string;
  result: InteractionResult | null;
  evidence: Partial<Record<CompareMethodId, CompareEvidence>>;
  stableIndex: number;
};

function isBmrMethod(id: CompareMethodId): id is Bmr {
  return BMR_IDS.some((bmr) => bmr === id);
}

export function comparisonMethods(
  direction: Direction,
  manifestMethods: ReleaseManifest["methods"],
  qThreshold = DEFAULT_Q_THRESHOLD,
  release?: Pick<ReleaseCatalogEntry, "schema_version">,
): CompareMethod[] {
  const bmrs = release ? bmrMethodsFor(release) : BMR_IDS.map((id) => BMR_METHODS[id]);
  const methods: CompareMethod[] = manifestMethods.dialect.directions.includes(direction)
    ? bmrs.map((method) => ({
        id: method.id as Bmr,
        label: method.label,
        measure: "q" as const,
        threshold: qThreshold,
        href: method.href,
      }))
    : [];
  for (const metadata of Object.values(COMPARISON_METHODS)) {
    if (
      !metadata.directions.includes(direction) ||
      !manifestMethods[metadata.id].directions.includes(direction)
    ) {
      continue;
    }
    methods.push({
      id: metadata.id,
      label: metadata.directionLabel?.[direction] ?? metadata.label,
      measure: metadata.measure,
      threshold: metadata.fixedThreshold ?? qThreshold,
      href: metadata.href,
    });
  }
  return methods;
}

function baselineValue(
  row: BaselineRow,
  method: BaselineMethodId,
  direction: Direction,
): number | null {
  if (method === "fisher") return direction === "ME" ? row.fisherMeQ : row.fisherCoQ;
  if (method === "discover") return direction === "ME" ? row.discoverMeQ : row.discoverCoQ;
  if (method === "megsa") return direction === "ME" ? row.megsaP : null;
  return direction === "ME" ? row.wesmeQ : row.wescoQ;
}

function canonicalGenes(ga: string, gb: string): [string, string] {
  return codePointCompare(ga, gb) <= 0 ? [ga, gb] : [gb, ga];
}

function lowestRankByPair(rows: DialectRow[], includeSameGenePairs = false): Map<string, DialectRow> {
  const byPair = new Map<string, DialectRow>();
  rows.forEach((row) => {
    if (!includeSameGenePairs && baseGene(row.ga) === baseGene(row.gb)) return;
    const key = pairKey(row.ga, row.gb);
    const prior = byPair.get(key);
    if (!prior || row.rank < prior.rank) byPair.set(key, row);
  });
  return byPair;
}

export function buildComparisonRows(
  data: CohortData,
  direction: Direction,
  methods: CompareMethod[],
): ComparisonRow[] {
  const modelRows = Object.fromEntries(
    BMR_IDS.map((bmr) => [bmr, lowestRankByPair(data.models[bmr], data.includeSameGenePairs)]),
  ) as Record<Bmr, Map<string, DialectRow>>;
  const baselines = new Map<string, BaselineRow>();
  data.baselines.forEach((row) => {
    if (data.includeSameGenePairs || baseGene(row.ga) !== baseGene(row.gb)) baselines.set(pairKey(row.ga, row.gb), row);
  });
  const fallbacks = new Set(data.mutsigCbaseFallbackFeatures);
  const candidates = new Set<string>();

  methods.forEach((method) => {
    const methodId = method.id;
    if (isBmrMethod(methodId)) {
      modelRows[methodId].forEach((row, key) => {
        if (row.direction === direction && isSignificant(row, method.threshold)) {
          candidates.add(key);
        }
      });
      return;
    }
    baselines.forEach((row, key) => {
      const value = baselineValue(
        row,
        methodId,
        direction,
      );
      if (value != null && value < method.threshold) candidates.add(key);
    });
  });

  return [...candidates]
    .sort(codePointCompare)
    .map((key, stableIndex) => {
      const [rawA, rawB] = key.split("::");
      const [ga, gb] = canonicalGenes(rawA, rawB);
      const evidence: ComparisonRow["evidence"] = {};
      methods.forEach((method) => {
        const methodId = method.id;
        if (isBmrMethod(methodId)) {
          // K=500 reaches pairs outside the materialized subset through the full table.
          const row = modelRows[methodId].get(key) ?? data.lookupPair?.(methodId, ga, gb) ?? undefined;
          const value = row?.q ?? null;
          const significant = row != null && isSignificant(row, method.threshold);
          evidence[methodId] = {
            method,
            tested: row != null,
            value,
            significant,
            supported: row?.direction === direction && significant,
            assignedDirection: row?.direction,
            fallback:
              methodId === "mutsig" &&
              row != null &&
              (fallbacks.has(row.ga) || fallbacks.has(row.gb)),
          };
          return;
        }
        const baseline = baselines.get(key) ?? data.lookupBaseline?.(ga, gb) ?? undefined;
        const value = baseline
          ? baselineValue(
              baseline,
              methodId,
              direction,
            )
          : null;
        const significant = value != null && value < method.threshold;
        evidence[methodId] = {
          method,
          tested: value != null,
          value,
          significant,
          supported: significant,
        };
      });
      return {
        id: `${direction}::${key}`,
        ga,
        gb,
        result: findResult(data, { direction, ga, gb }),
        evidence,
        stableIndex,
      };
    });
}

export function sortComparisonRows(
  rows: ComparisonRow[],
  method: CompareMethodId,
  direction: CompareSortDirection,
): ComparisonRow[] {
  const multiplier = direction === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aValue = a.evidence[method]?.value ?? null;
    const bValue = b.evidence[method]?.value ?? null;
    if (aValue == null && bValue == null) return a.stableIndex - b.stableIndex;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    const byValue = (aValue - bValue) * multiplier;
    return byValue || a.stableIndex - b.stableIndex;
  });
}
