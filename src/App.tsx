import { useEffect, useMemo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Footer } from "@/components/Footer";
import { SiteNav } from "@/components/SiteNav";
import { Button } from "@/components/ui/button";
import { AboutView } from "@/features/atlas/components/AboutView";
import { CohortHeader } from "@/features/atlas/components/CohortHeader";
import { CompareView } from "@/features/atlas/components/CompareView";
import { ContactView } from "@/features/atlas/components/ContactView";
import { InitialCohortChooser } from "@/features/atlas/components/CohortChooser";
import { ExploreView, ResultsSkeleton } from "@/features/atlas/components/ExploreView";
import { PairDialog } from "@/features/atlas/components/PairDialog";
import { SettingsDrawer } from "@/features/atlas/components/SettingsDrawer";
import { useCohort, useRelease } from "@/features/atlas/hooks/useAtlas";
import {
  findResult,
  findResultForMode,
  parsePairId,
} from "@/features/atlas/lib/atlas-transform";
import {
  defaultModeFor,
  resolveRelease,
  studyOfCohort,
} from "@/features/atlas/lib/release-catalog";
import type { InteractionResult } from "@/features/atlas/types";
import { useHashState } from "@/lib/useHashState";

function FullPageLoading() {
  return (
    <main id="main" tabIndex={-1} className="site-shell flex min-h-[70vh] items-center justify-center" role="status">
      <div className="w-full max-w-xl space-y-4 text-center">
        <div className="mx-auto h-4 w-32 animate-pulse rounded-full bg-ink/[0.07]" />
        <div className="mx-auto h-20 w-full animate-pulse rounded-[2rem] bg-paper" />
        <p className="text-sm font-semibold text-muted">Loading the immutable release…</p>
      </div>
    </main>
  );
}

function ErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto my-20 max-w-2xl rounded-[2rem] border border-alert/20 bg-paper p-8 text-center shadow-soft">
      <AlertTriangle className="mx-auto size-7 text-alert" aria-hidden />
      <h1 className="mt-4 text-2xl font-black tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        The Atlas will not substitute another release or invent missing results. Please retry or inspect the immutable release files.
      </p>
      {error && <p className="mt-4 break-words rounded-xl bg-sand p-3 font-mono text-[11px] leading-5 text-muted">{error}</p>}
      <Button className="mt-6" onClick={onRetry}>
        <RefreshCw className="size-4" aria-hidden />
        Retry
      </Button>
    </div>
  );
}

export function App() {
  const [url, setUrl] = useHashState();
  const releaseEntry = resolveRelease(url.release, url.cohort);
  const release = useRelease(releaseEntry.id);
  // Never pair a cohort with a bundle from a release the URL has already left.
  const bundle = release.data?.entry.id === releaseEntry.id ? release.data : null;
  const cohortMeta = bundle?.index.cohorts.find((cohort) => cohort.id === url.cohort) ?? null;
  const isResultsView = url.view === "explore" || url.view === "compare";
  const shouldLoadCohort = isResultsView && cohortMeta != null;
  const cohort = useCohort(shouldLoadCohort ? cohortMeta : null, releaseEntry.id);
  const likelyPassengers = useMemo(
    () => new Set(
      cohortMeta && bundle
        ? bundle.likelyPassengers.cohorts[cohortMeta.id] ?? []
        : [],
    ),
    [cohortMeta, bundle],
  );
  const selection = useMemo(() => parsePairId(url.pair), [url.pair]);
  const selectedResult = useMemo(
    () =>
      cohort.data && selection
        ? url.view === "compare"
            ? findResult(cohort.data, selection)
            : findResultForMode(cohort.data, selection, url.mode, {
              qThreshold: url.qThreshold,
              minIdentifiedBmrs: url.minIdentifiedBmrs,
              minSignificantBmrs: url.minSignificantBmrs,
              significantOnly: url.significantOnly,
            })
        : null,
    [
      cohort.data,
      selection,
      url.minIdentifiedBmrs,
      url.minSignificantBmrs,
      url.mode,
      url.qThreshold,
      url.significantOnly,
      url.view,
    ],
  );

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [url.cohort, url.view]);

  useEffect(() => {
    if (url.pair && cohort.status === "ready" && !selectedResult) {
      setUrl({ pair: undefined }, { replace: true });
    }
  }, [cohort.status, selectedResult, setUrl, url.pair]);

  const chooseCohort = (id: string) => {
    setUrl({ cohort: id, pair: undefined, settings: false });
  };
  const chooseRelease = (id: string) => {
    if (id === releaseEntry.id) return;
    const next = resolveRelease(id);
    const study = studyOfCohort(url.cohort);
    setUrl({
      release: next.id,
      mode: defaultModeFor(next),
      qThreshold: next.default_q_threshold ?? 0.01,
      cohort: study && next.studies.includes(study) ? url.cohort : undefined,
      pair: undefined,
      settings: false,
    });
  };
  const selectPair = (result: InteractionResult) => setUrl({ pair: result.id });
  const customize = (
    <SettingsDrawer
      open={url.settings}
      showBackground={url.view === "explore"}
      showConsensusThresholds={url.view === "explore" && url.mode === "consensus"}
      mode={url.mode}
      release={releaseEntry}
      qThreshold={url.qThreshold}
      minIdentifiedBmrs={url.minIdentifiedBmrs}
      minSignificantBmrs={url.minSignificantBmrs}
      highlightLikelyPassengers={url.highlightLikelyPassengers}
      onOpenChange={(settings) => setUrl({ settings }, { replace: !settings })}
      onModeChange={(mode) => setUrl({ mode, pair: undefined })}
      onQThresholdChange={(qThreshold) => setUrl({ qThreshold, pair: undefined })}
      onMinIdentifiedBmrsChange={(minIdentifiedBmrs) =>
        setUrl({ minIdentifiedBmrs, pair: undefined })
      }
      onMinSignificantBmrsChange={(minSignificantBmrs) =>
        setUrl({ minSignificantBmrs, pair: undefined })
      }
      onHighlightLikelyPassengersChange={(highlightLikelyPassengers) =>
        setUrl({ highlightLikelyPassengers })
      }
    />
  );

  return (
    <div className="min-h-screen">
      <SiteNav state={url} />

      {url.view === "contact" && (
        <main id="main" tabIndex={-1} className="site-shell outline-none">
          <ContactView />
        </main>
      )}

      {url.view !== "contact" && !bundle && release.status !== "error" && <FullPageLoading />}
      {url.view !== "contact" && release.status === "error" && (
        <main id="main" tabIndex={-1} className="site-shell">
          <ErrorState title="Release data unavailable" error={release.error} onRetry={release.retry} />
        </main>
      )}

      {url.view !== "contact" && bundle && (
        <main id="main" tabIndex={-1} className="outline-none">
          {url.view === "about" ? (
            <div className="site-shell">
              <AboutView bundle={bundle} cohort={cohortMeta} onReleaseChange={chooseRelease} />
            </div>
          ) : !url.cohort || !cohortMeta ? (
            <>
              {url.cohort && (
                <p role="alert" className="site-shell pt-8 text-center text-sm font-bold text-alert">
                  That cohort is not part of this immutable release. Choose another.
                </p>
              )}
              <InitialCohortChooser
                cohorts={bundle.index.cohorts}
                onSelect={chooseCohort}
                release={releaseEntry}
                onReleaseChange={chooseRelease}
              />
            </>
          ) : (
            <div className="site-shell pb-16">
              <CohortHeader
                view={url.view}
                cohort={cohortMeta}
                cohorts={bundle.index.cohorts}
                onCohortChange={chooseCohort}
                release={releaseEntry}
                onReleaseChange={chooseRelease}
              />

              {cohort.status === "loading" && <ResultsSkeleton />}
              {cohort.status === "error" && (
                <ErrorState title="Cohort data unavailable" error={cohort.error} onRetry={cohort.retry} />
              )}
              {cohort.data && url.view === "explore" && (
                <ExploreView
                  data={cohort.data}
                  release={releaseEntry}
                  mode={url.mode}
                  display={url.exploreDisplay}
                  qThreshold={url.qThreshold}
                  minIdentifiedBmrs={url.minIdentifiedBmrs}
                  minSignificantBmrs={url.minSignificantBmrs}
                  significantOnly={url.significantOnly}
                  onDisplayChange={(exploreDisplay) => setUrl({ exploreDisplay })}
                  onSignificantOnlyChange={(significantOnly) =>
                    setUrl({ significantOnly, pair: undefined })
                  }
                  customize={customize}
                  likelyPassengers={likelyPassengers}
                  highlightLikelyPassengers={url.highlightLikelyPassengers}
                  onSelect={selectPair}
                />
              )}
              {cohort.data && url.view === "compare" && (
                <CompareView
                  data={cohort.data}
                  manifestMethods={bundle.manifest.methods}
                  release={releaseEntry}
                  qThreshold={url.qThreshold}
                  direction={url.compareDirection}
                  onDirectionChange={(compareDirection) => setUrl({ compareDirection })}
                  customize={customize}
                  likelyPassengers={likelyPassengers}
                  highlightLikelyPassengers={url.highlightLikelyPassengers}
                  onSelect={selectPair}
                />
              )}

              {cohort.data && (
                <PairDialog
                  result={selectedResult}
                  release={releaseEntry}
                  mode={url.view === "compare" ? defaultModeFor(releaseEntry) : url.mode}
                  qThreshold={url.qThreshold}
                  minIdentifiedBmrs={url.minIdentifiedBmrs}
                  minSignificantBmrs={url.minSignificantBmrs}
                  likelyPassengers={likelyPassengers}
                  highlightLikelyPassengers={url.highlightLikelyPassengers}
                  open={selectedResult != null}
                  onOpenChange={(open) => !open && setUrl({ pair: undefined }, { replace: true })}
                />
              )}
            </div>
          )}
        </main>
      )}

      <Footer releaseId={bundle?.manifest.release_id} />
    </div>
  );
}
