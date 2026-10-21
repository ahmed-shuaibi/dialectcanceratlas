import { useMemo } from "react";
import { InteractionLane } from "@/features/atlas/components/InteractionLane";
import type { AtlasMode, BmrCount, Direction, InteractionResult } from "@/features/atlas/types";

export function InteractionList({
  results,
  mode,
  qThreshold,
  minIdentifiedBmrs,
  minSignificantBmrs,
  likelyPassengers,
  highlightLikelyPassengers,
  onSelect,
  totals,
  significantOnly = false,
}: {
  results: InteractionResult[];
  /** Exact per-direction totals when the listed rows are a capped head (K=500). */
  totals?: Record<Direction, number>;
  significantOnly?: boolean;
  mode: AtlasMode;
  qThreshold: number;
  minIdentifiedBmrs: BmrCount;
  minSignificantBmrs: BmrCount;
  likelyPassengers: ReadonlySet<string>;
  highlightLikelyPassengers: boolean;
  onSelect: (result: InteractionResult) => void;
}) {
  const me = useMemo(
    () => results.filter(({ direction }) => direction === "ME"),
    [results],
  );
  const co = useMemo(
    () => results.filter(({ direction }) => direction === "CO"),
    [results],
  );
  return (
    <div>
      {highlightLikelyPassengers && (
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
          <span className="size-2.5 rounded-full bg-passenger" aria-hidden />
          Likely passenger gene effect
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InteractionLane
          direction="ME"
          results={me}
          total={totals?.ME}
          significantOnly={significantOnly}
          mode={mode}
          qThreshold={qThreshold}
          minIdentifiedBmrs={minIdentifiedBmrs}
          minSignificantBmrs={minSignificantBmrs}
          likelyPassengers={likelyPassengers}
          highlightLikelyPassengers={highlightLikelyPassengers}
          onSelect={onSelect}
        />
        <InteractionLane
          direction="CO"
          results={co}
          total={totals?.CO}
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
    </div>
  );
}
