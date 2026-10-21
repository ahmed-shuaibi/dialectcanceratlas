import type {
  AtlasMode,
  Bmr,
  CohortMeta,
  Direction,
  ManifestMethodId,
  ReleaseCatalogEntry,
} from "@/features/atlas/types";

export type MethodMetadata = {
  id: string;
  label: string;
  family: "DIALECT" | "Background" | "Comparison";
  href: string;
  summary: string;
};

export type BaselineMethodId = Exclude<ManifestMethodId, "dialect">;

export type ComparisonMethodMetadata = MethodMetadata & {
  id: BaselineMethodId;
  directions: readonly Direction[];
  directionLabel?: Partial<Record<Direction, string>>;
  measure: "q" | "p";
  fixedThreshold?: number;
};

export const ATLAS_LINKS = {
  contactEmail: "shuaibi.ahmed.a@gmail.com",
  personalSite: "https://ahmedshuaibi.com",
  paper: "https://doi.org/10.1101/2024.04.24.590995",
  source: "https://github.com/raphael-group/dialect",
} as const;

export const STUDIES = [
  { id: "TCGA", label: "TCGA PanCan Atlas" },
  { id: "MSK-IMPACT", label: "MSK-IMPACT" },
  { id: "MSK-CHORD", label: "MSK-CHORD" },
] as const;

export type StudyId = (typeof STUDIES)[number]["id"];

export const STUDY_BY_ID = Object.fromEntries(
  STUDIES.map((study) => [study.id, study]),
) as Readonly<Record<StudyId, (typeof STUDIES)[number]>>;

export const BMR_METHODS: Record<Bmr, MethodMetadata> = {
  cbase: {
    id: "cbase",
    label: "CBaSE",
    family: "Background",
    href: "https://doi.org/10.1038/ng.3987",
    summary: "Primary background.",
  },
  dig: {
    id: "dig",
    label: "DIG",
    family: "Background",
    href: "https://doi.org/10.1038/s41587-022-01353-8",
    summary: "Gene-level sensitivity.",
  },
  mutsig: {
    id: "mutsig",
    label: "MutSigCV2",
    family: "Background",
    href: "https://doi.org/10.1038/nature12213",
    summary: "Sample-aware sensitivity.",
  },
};

export const BMR_LABEL = Object.fromEntries(
  Object.entries(BMR_METHODS).map(([id, method]) => [id, method.label]),
) as Record<Bmr, string>;

export const ATLAS_MODES: ReadonlyArray<{
  value: AtlasMode;
  label: string;
  detail: string;
  href?: string;
}> = [
  {
    value: "consensus",
    label: "Consensus",
    detail: "Agreement across independent backgrounds.",
  },
  ...Object.values(BMR_METHODS).map((method) => ({
    value: method.id as Bmr,
    label: method.label,
    detail: method.summary,
    href: method.href,
  })),
];

export const COMPARISON_METHODS: Record<
  BaselineMethodId,
  ComparisonMethodMetadata
> = {
  fisher: {
    id: "fisher",
    label: "Fisher",
    family: "Comparison",
    href: "https://doi.org/10.1111/j.2397-2335.1922.tb00768.x",
    summary: "Exact test on observed mutation status.",
    directions: ["ME", "CO"],
    measure: "q",
  },
  discover: {
    id: "discover",
    label: "DISCOVER",
    family: "Comparison",
    href: "https://doi.org/10.1186/s13059-016-1114-x",
    summary: "Accounts for heterogeneous tumor alteration rates.",
    directions: ["ME", "CO"],
    measure: "q",
  },
  megsa: {
    id: "megsa",
    label: "MEGSA",
    family: "Comparison",
    href: "https://doi.org/10.1016/j.ajhg.2015.12.021",
    summary: "Likelihood framework for mutual exclusivity.",
    directions: ["ME"],
    measure: "p",
    fixedThreshold: 0.001,
  },
  wesme_wesco: {
    id: "wesme_wesco",
    label: "WeSME / WeSCO",
    family: "Comparison",
    href: "https://doi.org/10.1093/bioinformatics/btw242",
    summary: "Weighted sampling for exclusivity and co-occurrence.",
    directions: ["ME", "CO"],
    directionLabel: { ME: "WeSME", CO: "WeSCO" },
    measure: "q",
  },
};

export const METHODS: readonly MethodMetadata[] = [
  {
    id: "dialect",
    label: "DIALECT",
    family: "DIALECT",
    href: ATLAS_LINKS.paper,
    summary: "Tests dependence between latent driver states.",
  },
  ...Object.values(BMR_METHODS),
  ...Object.values(COMPARISON_METHODS),
];

export const DIRECTION_METADATA: Record<
  Direction,
  { label: string; detail: string; metric: string }
> = {
  ME: {
    label: "Mutually exclusive",
    detail: "Found together less often than expected.",
    metric: "rho",
  },
  CO: {
    label: "Co-occurring",
    detail: "Found together more often than expected.",
    metric: "LRT",
  },
};

export function studyLabel(study: string): string {
  return STUDY_BY_ID[study as StudyId]?.label ?? study;
}

export function cohortTag(cohort: CohortMeta): string {
  return cohort.cohort;
}

/** Background roles differ by release: K=500 is MutSig-primary, K=100 CBaSE-primary. */
const K500_BMR_SUMMARY: Record<Bmr, string> = {
  mutsig: "Primary background.",
  cbase: "Continuity comparison.",
  dig: "Gene-level sensitivity.",
};

export function isRevisionRelease(entry: Pick<ReleaseCatalogEntry, "schema_version" | "available_bmrs">): boolean {
  return entry.schema_version === "3.0.0";
}

export function bmrMethodsFor(entry: Pick<ReleaseCatalogEntry, "schema_version" | "available_bmrs">): MethodMetadata[] {
  if (!isRevisionRelease(entry)) return Object.values(BMR_METHODS);
  return (["mutsig", "cbase", "dig"] as const).filter((bmr) => !entry.available_bmrs || entry.available_bmrs.includes(bmr)).map((bmr) => ({
    ...BMR_METHODS[bmr],
    summary: K500_BMR_SUMMARY[bmr],
  }));
}

export function atlasModesFor(
  entry: Pick<ReleaseCatalogEntry, "schema_version" | "available_bmrs">,
): typeof ATLAS_MODES {
  if (!isRevisionRelease(entry)) return ATLAS_MODES;
  return [
    ...bmrMethodsFor(entry).map((method) => ({
      value: method.id as Bmr,
      label: method.label,
      detail: method.summary,
      href: method.href,
    })),
    ...(bmrMethodsFor(entry).length > 1 ? [{
      value: "consensus" as const,
      label: "Overlap",
      detail: "Descriptive agreement across backgrounds.",
    }] : []),
  ];
}

export function methodsFor(entry: Pick<ReleaseCatalogEntry, "schema_version" | "available_bmrs">): MethodMetadata[] {
  return [METHODS[0], ...bmrMethodsFor(entry), ...Object.values(COMPARISON_METHODS)];
}

/** How the release names its primary q and comparison, e.g. "BY q ≤" or "q <". */
export function qCutoffLabel(entry: Pick<ReleaseCatalogEntry, "schema_version" | "available_bmrs">): string {
  return isRevisionRelease(entry) ? "BY q ≤" : "q <";
}
