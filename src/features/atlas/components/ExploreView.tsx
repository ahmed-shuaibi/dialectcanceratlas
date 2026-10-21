import { Check, List, ListFilter, Share2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { InteractionList } from "@/features/atlas/components/InteractionList";
import { ResultsToolbar } from "@/features/atlas/components/ResultsToolbar";
import { resultsForNetwork } from "@/features/atlas/components/explore-display";
import { isRevisionRelease, qCutoffLabel } from "@/features/atlas/lib/atlas-metadata";
import { exploreResults, filterResultsByGene, fmtInt } from "@/features/atlas/lib/atlas-transform";
import type {
  AtlasMode,
  BmrCount,
  CohortData,
  ExploreDisplay,
  InteractionResult,
  ReleaseCatalogEntry,
} from "@/features/atlas/types";

const InteractionNetwork = lazy(async () => {
  const module = await import("@/features/atlas/components/InteractionNetwork");
  return { default: module.InteractionNetwork };
});

const DISPLAY_OPTIONS = [
  { value: "list", label: "List", icon: <List className="size-4" aria-hidden /> },
  { value: "network", label: "Network", icon: <Share2 className="size-4" aria-hidden /> },
] as const;

function EmptyExplore({
  query,
  mode,
  cutoffLabel,
  qThreshold,
  significantOnly,
  onClearQuery,
  onShowRanked,
}: {
  query: string;
  mode: AtlasMode;
  cutoffLabel: string;
  qThreshold: number;
  significantOnly: boolean;
  onClearQuery: () => void;
  onShowRanked: () => void;
}) {
  const searched = query.trim().length > 0;
  return (
    <div className="surface-card py-20 text-center">
      <p className="text-xl font-semibold">
        {searched
          ? "No pairs match that gene."
          : mode === "consensus"
            ? `No pairs meet these ${cutoffLabel.startsWith("BY") ? "overlap" : "consensus"} settings.`
            : significantOnly
              ? `No pairs meet ${cutoffLabel} ${qThreshold}.`
              : "No pairs in this background."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {searched && (
          <Button type="button" onClick={onClearQuery} size="sm">
            Clear search
          </Button>
        )}
        {!searched && significantOnly && (
          <Button type="button" variant="outline" size="sm" onClick={onShowRanked}>
            Show ranked pairs
          </Button>
        )}
      </div>
    </div>
  );
}

export function ExploreView({
  data,
  release,
  mode,
  display,
  qThreshold,
  minIdentifiedBmrs,
  minSignificantBmrs,
  significantOnly,
  onDisplayChange,
  onSignificantOnlyChange,
  onSelect,
  customize,
  likelyPassengers,
  highlightLikelyPassengers,
}: {
  data: CohortData;
  /** Absent in isolated renders: fall back to the K=100 copy. */
  release?: ReleaseCatalogEntry;
  mode: AtlasMode;
  display: ExploreDisplay;
  qThreshold: number;
  minIdentifiedBmrs: BmrCount;
  minSignificantBmrs: BmrCount;
  significantOnly: boolean;
  onDisplayChange: (display: ExploreDisplay) => void;
  onSignificantOnlyChange: (significantOnly: boolean) => void;
  onSelect: (result: InteractionResult) => void;
  customize: ReactNode;
  likelyPassengers: ReadonlySet<string>;
  highlightLikelyPassengers: boolean;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [data.id]);
  const results = useMemo(
    () => exploreResults(data, mode, {
      qThreshold,
      minIdentifiedBmrs,
      minSignificantBmrs,
      significantOnly,
    }),
    [
      data,
      minIdentifiedBmrs,
      minSignificantBmrs,
      mode,
      qThreshold,
      significantOnly,
    ],
  );
  const visibleResults = useMemo(
    () => filterResultsByGene(results, query),
    [query, results],
  );
  // K=500 lists are a capped ranked head; name the exact totals for one background.
  const totals = useMemo(() => {
    if (!data.countDirectional || mode === "consensus" || query.trim()) return undefined;
    const threshold = significantOnly ? qThreshold : null;
    return {
      ME: data.countDirectional(mode, "ME", threshold),
      CO: data.countDirectional(mode, "CO", threshold),
    };
  }, [data, mode, qThreshold, query, significantOnly]);
  const networkResults = useMemo(
    () => resultsForNetwork(visibleResults),
    [visibleResults],
  );
  const unassigned = data.testedPairs != null && data.directionTotals && mode !== "consensus"
    ? data.testedPairs - data.directionTotals[mode].ME - data.directionTotals[mode].CO
    : null;
  const significantCounts = useMemo(() => data.countDirectional && mode !== "consensus"
    ? { ME: data.countDirectional(mode, "ME", qThreshold), CO: data.countDirectional(mode, "CO", qThreshold) }
    : null, [data, mode, qThreshold]);

  return (
    <section aria-label="Interaction results">
      <ResultsToolbar
        controls={(
          <>
            <SegmentedControl
              value={display}
              options={DISPLAY_OPTIONS}
              onChange={onDisplayChange}
              label="Explore display"
            />
            <Button
              type="button"
              variant="filter"
              size="sm"
              aria-pressed={significantOnly}
              onClick={() => onSignificantOnlyChange(!significantOnly)}
            >
              {significantOnly
                ? <Check className="size-4" aria-hidden />
                : <ListFilter className="size-4" aria-hidden />}
              Significant only
            </Button>
          </>
        )}
        search={(
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Find a gene"
            label="Find a gene"
          />
        )}
        customize={customize}
      />

      <div className="mb-4 rounded-2xl border border-line bg-paper px-5 py-4" aria-label="Result scope">
        <p className="font-semibold">
          {significantOnly
            ? `Significant pairs only · ${release ? qCutoffLabel(release) : "q <"} ${qThreshold}`
            : "Ranked pairs · includes non-significant results"}
        </p>
        {!significantOnly && (
          <p className="mt-1 text-sm text-muted">
            {significantCounts
              ? `Significant at ${release ? qCutoffLabel(release) : "q <"} ${qThreshold}: ${fmtInt(significantCounts.ME)} ME, ${fmtInt(significantCounts.CO)} CO. Select “Significant only” to view them.`
              : "The counts below are ranked pairs, not significant discoveries. Select “Significant only” to apply the q-value cutoff."}
          </p>
        )}
        {release && isRevisionRelease(release) && data.testedPairs != null && (
          <p className="mt-1 text-sm text-muted">
            {fmtInt(data.testedPairs)} pairs tested.
            {unassigned != null && unassigned > 0 && ` ${fmtInt(unassigned)} have no defined ME/CO direction.`}
            {" "}The full tested set is in the downloadable release.
          </p>
        )}
      </div>

      {visibleResults.length === 0 ? (
        <EmptyExplore
          query={query}
          mode={mode}
          cutoffLabel={release ? qCutoffLabel(release) : "q <"}
          qThreshold={qThreshold}
          significantOnly={significantOnly}
          onClearQuery={() => setQuery("")}
          onShowRanked={() => onSignificantOnlyChange(false)}
        />
      ) : display === "network" ? (
        <div className="view-enter" key="network">
          <Suspense
            fallback={
              <div
                role="status"
                className="surface-card grid h-[min(68vh,720px)] min-h-[31rem] place-items-center text-base font-semibold text-muted"
              >
                Drawing interaction network…
              </div>
            }
          >
            <InteractionNetwork
              results={networkResults}
              totalResults={visibleResults.length}
              mode={mode}
              qThreshold={qThreshold}
              minIdentifiedBmrs={minIdentifiedBmrs}
              minSignificantBmrs={minSignificantBmrs}
              likelyPassengers={likelyPassengers}
              highlightLikelyPassengers={highlightLikelyPassengers}
              onSelect={onSelect}
            />
          </Suspense>
        </div>
      ) : (
        <div className="view-enter" key="list">
          <InteractionList
            results={visibleResults}
            totals={totals}
            significantOnly={significantOnly}
            mode={mode}
            qThreshold={qThreshold}
            minIdentifiedBmrs={minIdentifiedBmrs}
            minSignificantBmrs={minSignificantBmrs}
            likelyPassengers={likelyPassengers}
            highlightLikelyPassengers={highlightLikelyPassengers}
            onSelect={onSelect}
          />
        </div>
      )}
    </section>
  );
}

export function ResultsSkeleton() {
  return (
    <div aria-label="Loading cohort interactions" role="status" className="space-y-5">
      <div className="h-11 w-full max-w-xl animate-pulse rounded-full bg-ink/[0.07]" />
      <div className="h-[min(68vh,720px)] min-h-[31rem] animate-pulse rounded-[24px] bg-paper" />
    </div>
  );
}
