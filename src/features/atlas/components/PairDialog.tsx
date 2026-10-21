import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ObservedMatrix } from "@/features/atlas/components/pair/ObservedMatrix";
import { PairEvidenceCard } from "@/features/atlas/components/pair/PairEvidenceCard";
import { PairTechnicalDetails } from "@/features/atlas/components/pair/PairTechnicalDetails";
import { modelState } from "@/features/atlas/components/pair/pair-evidence";
import { BMR_LABEL, bmrMethodsFor, qCutoffLabel } from "@/features/atlas/lib/atlas-metadata";
import {
  backgroundSupport,
  resultIsSignificant,
} from "@/features/atlas/lib/atlas-transform";
import {
  BMR_IDS,
  DEFAULT_MIN_IDENTIFIED_BMRS,
  DEFAULT_MIN_SIGNIFICANT_BMRS,
  DEFAULT_Q_THRESHOLD,
  type AtlasMode,
  type Bmr,
  type BmrCount,
  type DialectRow,
  type InteractionResult,
  type ReleaseCatalogEntry,
} from "@/features/atlas/types";
import { cn } from "@/lib/utils";

export type PairDialogProps = {
  result: InteractionResult | null;
  /** Absent in isolated renders: fall back to the K=100 copy. */
  release?: ReleaseCatalogEntry;
  mode: AtlasMode;
  qThreshold: number;
  minIdentifiedBmrs: BmrCount;
  minSignificantBmrs: BmrCount;
  likelyPassengers: ReadonlySet<string>;
  highlightLikelyPassengers: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PairDialog(props: PairDialogProps) {
  const {
    result,
    release,
    mode,
    qThreshold = DEFAULT_Q_THRESHOLD,
    minIdentifiedBmrs = DEFAULT_MIN_IDENTIFIED_BMRS,
    minSignificantBmrs = DEFAULT_MIN_SIGNIFICANT_BMRS,
    likelyPassengers,
    highlightLikelyPassengers,
    open,
    onOpenChange,
  } = props;
  if (!result) return null;
  const cutoff = `${release ? qCutoffLabel(release) : "q <"} ${qThreshold}`;
  const order = release ? bmrMethodsFor(release).map(({ id }) => id as Bmr) : [...BMR_IDS];
  const primary: Bmr = release?.default_mode === "consensus" || !release ? "cbase" : release.default_mode;
  const evidenceByModel = Object.fromEntries(
    BMR_IDS.map((bmr) => [
      bmr,
      result.pairEvidence.find((item) => item.bmr === bmr)?.row,
    ]),
  ) as Record<Bmr, DialectRow | undefined>;
  const support = backgroundSupport(result, qThreshold);
  const significantSupport = support.significant;
  const consensusSignificant = resultIsSignificant(result, "consensus", {
    qThreshold,
    minIdentifiedBmrs,
    minSignificantBmrs,
  });
  const selectedRow = mode === "consensus" ? undefined : evidenceByModel[mode];
  const selectedState = mode === "consensus" ? undefined : modelState(selectedRow, result, qThreshold);
  const selectedFallback =
    mode === "mutsig" &&
    selectedRow != null &&
    result.mutsigFallbackFeatures.length > 0;
  const consensusState = consensusSignificant ? "Significant" : "Not significant";
  const lead = mode === "consensus"
    ? `${consensusState} · ${support.identified}/${support.independent} identified · ${significantSupport}/${support.independent} significant`
    : selectedState === "unavailable"
      ? `Significant with ${BMR_LABEL[mode]}; direction unavailable`
    : selectedState === "significant"
      ? selectedFallback
        ? "Significant in MutSigCV2 view (CBaSE fallback)"
        : `Significant with ${BMR_LABEL[mode]}`
      : selectedState === "opposite"
        ? `Significant ${selectedRow?.direction ?? "opposite"} with ${BMR_LABEL[mode]}; opposite to ${result.direction}`
        : selectedState === "missing"
          ? `Not tested with ${BMR_LABEL[mode]}`
          : `Not significant with ${BMR_LABEL[mode]}`;
  const active =
    (mode !== "consensus" ? selectedRow : evidenceByModel[primary]) ??
    evidenceByModel[primary] ??
    result.pairEvidence[0]?.row;
  if (!active) return null;
  const me = result.direction === "ME";
  const passengerFeatures = highlightLikelyPassengers
    ? [result.ga, result.gb].filter((feature) => likelyPassengers.has(feature))
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="wide">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(23rem,0.82fr)] lg:items-stretch">
          <header className="pr-12 lg:py-4">
            <p className={cn("text-sm font-semibold", me ? "text-me" : "text-co")}>
              {me ? "Mutually exclusive" : "Co-occurring"}
            </p>
            <DialogTitle className="mt-3 break-words font-mono text-[clamp(1.65rem,4vw,2.75rem)] leading-tight">
              {result.ga} <span className="text-muted">/</span> {result.gb}
            </DialogTitle>
            <DialogDescription className="mt-3 max-w-2xl text-base leading-7">
              Inferred driver states occur {me ? "less" : "more"} often together than expected.
            </DialogDescription>
            <p className="mt-5 text-lg font-semibold">
              {lead}
            </p>
            <p className="mt-1 text-sm font-medium text-muted">
              {mode === "consensus"
                ? `Requires ≥${minIdentifiedBmrs} identified and ≥${minSignificantBmrs} significant at ${cutoff}.`
                : `${significantSupport} of ${release?.available_bmrs ? order.length : support.independent} meet ${cutoff}.`}
            </p>
            {passengerFeatures.length > 0 && (
              <p className="mt-4 inline-flex rounded-full bg-passenger-soft px-3 py-1.5 text-sm font-semibold text-passenger">
                Likely passenger: {passengerFeatures.join(", ")}
              </p>
            )}
            {result.mutsigFallbackFeatures.length > 0 && (
              <p className="mt-4 max-w-2xl text-xs font-semibold leading-5 text-alert">
                MutSigCV2 uses CBaSE fallback for {result.mutsigFallbackFeatures.join(" and ")}.
              </p>
            )}
          </header>

          <section
            aria-labelledby="observed-heading"
            className="rounded-[24px] border border-line bg-canvas/55 p-5 sm:p-6"
          >
            <h3 id="observed-heading" className="text-base font-semibold">Observed tumors</h3>
            <div className="mt-5">
              <ObservedMatrix row={active} result={result} />
            </div>
          </section>
        </div>

        <section aria-labelledby="model-evidence-heading" className="mt-7">
          <h3 id="model-evidence-heading" className="text-base font-semibold">Background evidence</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {order.map((bmr) => (
              <PairEvidenceCard
                key={bmr}
                bmr={bmr}
                row={evidenceByModel[bmr]}
                result={result}
                qThreshold={qThreshold}
              />
            ))}
          </div>
        </section>

        <PairTechnicalDetails
          evidenceByModel={evidenceByModel}
          order={order}
          mutsigFallbackFeatures={result.mutsigFallbackFeatures}
        />
      </DialogContent>
    </Dialog>
  );
}
