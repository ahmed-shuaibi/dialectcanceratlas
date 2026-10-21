import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { resultEffectText } from "@/features/atlas/components/explore-display";
import { DIRECTION_METADATA } from "@/features/atlas/lib/atlas-metadata";
import {
  backgroundSupport,
  resultQLabel,
  fmtInt,
  fmtQ,
  resultIsSignificant,
  resultQ,
} from "@/features/atlas/lib/atlas-transform";
import type {
  AtlasMode,
  BmrCount,
  Direction,
  InteractionResult,
} from "@/features/atlas/types";
import { cn } from "@/lib/utils";

const LIST_PAGE_SIZE = 60;

function GeneEffect({
  value,
  highlighted,
}: {
  value: string;
  highlighted: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 break-words">
      {highlighted && (
        <span
          className="size-2 shrink-0 rounded-full bg-passenger"
          aria-label="Likely passenger gene effect"
          title="Likely passenger gene effect"
        />
      )}
      {value}
    </span>
  );
}

export function InteractionLane({
  direction,
  results,
  mode,
  qThreshold,
  minIdentifiedBmrs,
  minSignificantBmrs,
  likelyPassengers,
  highlightLikelyPassengers,
  onSelect,
  total,
  significantOnly = false,
}: {
  direction: Direction;
  results: InteractionResult[];
  total?: number;
  significantOnly?: boolean;
  mode: AtlasMode;
  qThreshold: number;
  minIdentifiedBmrs: BmrCount;
  minSignificantBmrs: BmrCount;
  likelyPassengers: ReadonlySet<string>;
  highlightLikelyPassengers: boolean;
  onSelect: (result: InteractionResult) => void;
}) {
  const copy = DIRECTION_METADATA[direction];
  const [visible, setVisible] = useState(LIST_PAGE_SIZE);
  useEffect(() => setVisible(LIST_PAGE_SIZE), [results]);
  const shown = results.slice(0, visible);
  return (
    <section aria-labelledby={`${direction}-heading`} className="surface-card min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-5 py-5">
        <div>
          <h2
            id={`${direction}-heading`}
            className="text-xl font-semibold leading-tight sm:text-2xl"
          >
            {copy.label}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted">{copy.detail}</p>
        </div>
        <p className="shrink-0 font-mono text-sm text-muted">
          {total != null && total > results.length
            ? `${fmtInt(results.length)} shown / ${fmtInt(total)} ${significantOnly ? "significant" : "ranked"}`
            : `${fmtInt(results.length)} ${significantOnly ? "significant" : "ranked"} ${results.length === 1 ? "pair" : "pairs"}`}
        </p>
      </header>

      {results.length === 0 ? (
        <p className="px-5 py-12 text-base text-muted">
          No {direction} pairs in this view.
        </p>
      ) : (
        <ol className="space-y-1 p-2">
          {shown.map((result) => {
            const support = backgroundSupport(result, qThreshold);
            const significant = resultIsSignificant(result, mode, {
              qThreshold,
              minIdentifiedBmrs,
              minSignificantBmrs,
            });
            const q = resultQ(result, mode, minSignificantBmrs);
            const qLabel = resultQLabel(result, mode, minSignificantBmrs);
            const passengerA = highlightLikelyPassengers && likelyPassengers.has(result.ga);
            const passengerB = highlightLikelyPassengers && likelyPassengers.has(result.gb);
            return (
              <li key={result.id} data-result-id={result.id}>
                <button
                  type="button"
                  onClick={() => onSelect(result)}
                  className={cn(
                    "focus-ring group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-4 text-left transition-colors hover:bg-sand sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]",
                    significant && "bg-support-soft/60",
                    (passengerA || passengerB) && "shadow-[inset_4px_0_0_var(--passenger)]",
                  )}
                >
                  <span className="min-w-0 font-mono text-[15px] font-semibold tracking-[-0.015em]">
                    <GeneEffect value={result.ga} highlighted={passengerA} />
                    <span
                      aria-hidden
                      className={cn(
                        "mx-2 inline-block w-5 align-middle border-t-2",
                        direction === "ME" ? "border-solid border-me" : "border-dashed border-co",
                      )}
                    />
                    <GeneEffect value={result.gb} highlighted={passengerB} />
                  </span>
                  <span className="hidden font-mono text-[13px] font-medium sm:block">
                    {resultEffectText(result, mode)}
                  </span>
                  <span className="hidden whitespace-nowrap font-mono text-[13px] text-muted sm:block">
                    {qLabel} {fmtQ(q)}
                  </span>
                  <span className="flex items-center justify-end gap-2 text-sm font-semibold text-muted">
                    <ArrowUpRight className="size-4 transition-colors group-hover:text-ink" aria-hidden />
                  </span>
                  <span className="col-start-1 flex items-center gap-3 text-[13px] font-semibold sm:hidden">
                    <span className="font-mono">{resultEffectText(result, mode)}</span>
                    <span className="font-mono text-muted">{qLabel} {fmtQ(q)}</span>
                    <span className="text-muted">
                      {support.identified}/{support.independent} identified ·{" "}
                      {support.significant}/{support.independent} significant
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {visible < results.length && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setVisible((value) => Math.min(value + LIST_PAGE_SIZE, results.length))}
          className="m-3 w-[calc(100%-1.5rem)]"
        >
          Show {Math.min(LIST_PAGE_SIZE, results.length - visible)} more
        </Button>
      )}
    </section>
  );
}
