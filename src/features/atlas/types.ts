export const BMR_IDS = ["cbase", "dig", "mutsig"] as const;
export const BMR_COUNT_THRESHOLDS = [1, 2, 3] as const;
export const Q_THRESHOLDS = [0.001, 0.005, 0.01, 0.05] as const;
export const DEFAULT_Q_THRESHOLD = 0.01;
export const DEFAULT_MIN_IDENTIFIED_BMRS = 3;
export const DEFAULT_MIN_SIGNIFICANT_BMRS = 3;

export type Bmr = (typeof BMR_IDS)[number];
export type BmrCount = (typeof BMR_COUNT_THRESHOLDS)[number];
export type QThreshold = (typeof Q_THRESHOLDS)[number];
export type AtlasView = "explore" | "compare" | "about" | "contact";
export type AtlasMode = "consensus" | Bmr;
export type Direction = "ME" | "CO";
export type ExploreDisplay = "network" | "list";
/** "unavailable": the effect sign is undefined (K=500 non-identifiable pairs). */
export type TransportDirection = Direction | "neutral" | "unavailable";
export type ReleaseSchema = "2.0.0" | "3.0.0";

export interface ReleaseCatalogEntry {
  id: string;
  schema_version: ReleaseSchema;
  k: number;
  label: string;
  title: string;
  description: string;
  studies: string[];
  default_mode: AtlasMode;
  available_bmrs?: Bmr[];
  default_q_threshold?: QThreshold;
  annotation_file?: string;
}

export interface CompactTable {
  fields: string[];
  rows: unknown[][];
}

export interface ReleaseManifest {
  release_id: string;
  schema_version: string;
  immutable: boolean;
  generated_at: string;
  coverage: {
    cohorts: number;
    samples: number;
  };
  analysis: {
    top_k_event_features: number;
    fdr_threshold: number;
    /** "<" (K=100, BH) or "<=" (K=500, inclusive log-q rule). */
    fdr_operator: "<" | "<=";
    primary_provider: Bmr;
    primary_adjustment: string;
    sensitivity_adjustment: string | null;
  };
  bmrs: Array<{
    id: Bmr;
    label: string;
    role: string;
  }>;
  methods: Record<ManifestMethodId, { directions: Direction[] }>;
  index_file: string;
  readme_file: string;
  readme_sha256: string;
  readme_bytes: number;
}

export type ManifestMethodId =
  | "dialect"
  | "fisher"
  | "discover"
  | "megsa"
  | "wesme_wesco";

export interface CohortMeta {
  id: string;
  study: string;
  cohort: string;
  cancer: string;
  n_samples: number;
  median_mutations: number;
  cbio: string;
  k: number;
  data_file: string;
  data_sha256: string;
  data_bytes: number;
}

export interface ReleaseIndex {
  release_id: string;
  cohorts: CohortMeta[];
}

export interface ReleaseBundle {
  entry: ReleaseCatalogEntry;
  manifest: ReleaseManifest;
  index: ReleaseIndex;
  likelyPassengers: LikelyPassengerAnnotations;
}

export interface LikelyPassengerAnnotations {
  annotation_id: string;
  schema_version: string;
  definition: string;
  driver_reference: string;
  driver_reference_sha256: string;
  cohorts: Record<string, string[]>;
}

export interface DialectRow {
  ga: string;
  gb: string;
  tau00: number;
  tau10: number;
  tau01: number;
  tau11: number;
  observedBoth: number;
  observedBOnly: number;
  observedAOnly: number;
  observedNeither: number;
  tau1x: number;
  taux1: number;
  /** Null when the pair effect is not identifiable (K=500 releases). */
  rho: number | null;
  logOddsRatio: number | null;
  /** Raw transport value. Negative fitted values are treated as zero evidence. */
  lrt: number;
  wald: number | null;
  p: number | null;
  /** Release primary q: BH (K=100) or Benjamini-Yekutieli (K=500). */
  q: number | null;
  direction: TransportDirection;
  rank: number;
  tauMass: number;
  effectiveN: number;
  excludedSamples: number;
  /**
   * K=500 only: exact inclusive log-q decisions computed by the release builder,
   * bit i set when q <= Q_THRESHOLDS[i]. Absent rows compare q < threshold.
   */
  decisionBits?: number;
  /** K=500 only: nominal Benjamini-Hochberg sensitivity q. */
  bhQ?: number;
  identifiability?: string;
}

export interface BaselineRow {
  ga: string;
  gb: string;
  fisherMeP: number | null;
  fisherCoP: number | null;
  fisherMeQ: number | null;
  fisherCoQ: number | null;
  discoverMeP: number | null;
  discoverCoP: number | null;
  discoverMeQ: number | null;
  discoverCoQ: number | null;
  megsaScore: number | null;
  megsaP: number | null;
  megsaQ: number | null;
  wesmeP: number | null;
  wescoP: number | null;
  wesmeQ: number | null;
  wescoQ: number | null;
}

export interface CohortData {
  includeSameGenePairs?: boolean;
  id: string;
  drivers: string[];
  /**
   * Materialized rows. K=100 holds every tested pair; K=500 holds the ranked head of
   * each direction (every call at the largest q cutoff, at least the top ranks, at
   * most MATERIALIZED_CAP) and reaches every other pair through lookupPair.
   */
  models: Record<Bmr, DialectRow[]>;
  baselines: BaselineRow[];
  mutsigCbaseFallbackFeatures: string[];
  k?: number;
  testedPairs?: number;
  /** K=500: the per-direction ranked rows materialized even when not significant. */
  rankedPerDirection?: number;
  /** K=500: full-table ME/CO row counts, the denominators of rank percentiles. */
  directionTotals?: Record<Bmr, Record<Direction, number>>;
  /** K=500: directional rows materialized per background (the capped ranked head). */
  materializedPerDirection?: Record<Bmr, Record<Direction, number>>;
  /** K=500: whether any baseline test had more calls than were materialized. */
  baselineTruncated?: boolean;
  /** K=500: exact directional count, optionally only calls at a q cutoff. */
  countDirectional?: (bmr: Bmr, direction: Direction, qThreshold: number | null) => number;
  /** K=500: exact number of pairs any Compare method calls in a direction. */
  countSupported?: (direction: Direction, qThreshold: number) => number;
  lookupPair?: (bmr: Bmr, ga: string, gb: string) => DialectRow | null;
  lookupBaseline?: (ga: string, gb: string) => BaselineRow | null;
}

export interface ModelMatch {
  bmr: Bmr;
  row: DialectRow;
  percentile: number;
}

export interface PairEvidence {
  bmr: Bmr;
  /** The model row, oriented to the InteractionResult's ga/gb order. */
  row: DialectRow;
}

export interface InteractionResult {
  id: string;
  ga: string;
  gb: string;
  direction: Direction;
  representative: DialectRow;
  /** Same-direction rows used exclusively for consensus, support, and ranking. */
  matches: ModelMatch[];
  /** Every model row for this pair, including opposite and neutral directions. */
  pairEvidence: PairEvidence[];
  mutsigFallbackFeatures: string[];
  worstPercentile: number;
  medianPercentile: number;
}

export interface PairSelection {
  direction: Direction;
  ga: string;
  gb: string;
}

export interface AtlasUrlState {
  release: string;
  view: AtlasView;
  cohort?: string;
  mode: AtlasMode;
  pair?: string;
  settings: boolean;
  exploreDisplay: ExploreDisplay;
  qThreshold: QThreshold;
  minIdentifiedBmrs: BmrCount;
  minSignificantBmrs: BmrCount;
  significantOnly: boolean;
  compareDirection: Direction;
  highlightLikelyPassengers: boolean;
}
