import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExploreView } from "@/features/atlas/components/ExploreView";
import { defaultReleaseEntry } from "@/features/atlas/lib/release-catalog";
import type { CohortData } from "@/features/atlas/types";

const emptyData: CohortData = {
  id: "empty",
  drivers: [],
  models: { cbase: [], dig: [], mutsig: [] },
  baselines: [],
  mutsigCbaseFallbackFeatures: [],
};

describe("ExploreView", () => {
  it("separates tested pairs, ranked pairs, and the active significance filter", () => {
    const props = {
      data: { ...emptyData, testedPairs: 124748, directionTotals: {
        cbase: { ME: 0, CO: 0 }, dig: { ME: 0, CO: 0 }, mutsig: { ME: 63, CO: 271 },
      } },
      release: defaultReleaseEntry(), mode: "mutsig" as const, display: "list" as const,
      qThreshold: 0.05, minIdentifiedBmrs: 3 as const, minSignificantBmrs: 3 as const,
      significantOnly: false, onDisplayChange: vi.fn(), onSignificantOnlyChange: vi.fn(),
      customize: null, likelyPassengers: new Set<string>(), highlightLikelyPassengers: false,
      onSelect: vi.fn(),
    };
    const { rerender } = render(<ExploreView {...props} />);
    expect(screen.getByText("Ranked pairs · includes non-significant results")).toBeInTheDocument();
    expect(screen.getByText(/124,748 pairs tested/)).toHaveTextContent("124,414 have no defined ME/CO direction.");
    rerender(<ExploreView {...props} significantOnly />);
    expect(screen.getByText("Significant pairs only · BY q ≤ 0.05")).toBeInTheDocument();
    expect(screen.queryByText(/The counts below are ranked pairs/)).not.toBeInTheDocument();
  });

  it("offers one-step recovery when the significant-only filter has no results", () => {
    const onSignificantOnlyChange = vi.fn();
    render(
      <ExploreView
        data={emptyData}
        mode="consensus"
        display="list"
        qThreshold={0.01}
        minIdentifiedBmrs={3}
        minSignificantBmrs={3}
        significantOnly
        onDisplayChange={() => undefined}
        onSignificantOnlyChange={onSignificantOnlyChange}
        customize={<button type="button">Customize</button>}
        likelyPassengers={new Set()}
        highlightLikelyPassengers={false}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText("No pairs meet these consensus settings.")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Explore display" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /significant interactions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /direction/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show ranked pairs" }));
    expect(onSignificantOnlyChange).toHaveBeenCalledWith(false);
  });

  it("uses a compact gene search with a clear recovery action", () => {
    render(
      <ExploreView
        data={emptyData}
        mode="cbase"
        display="list"
        qThreshold={0.005}
        minIdentifiedBmrs={3}
        minSignificantBmrs={3}
        significantOnly={false}
        onDisplayChange={() => undefined}
        onSignificantOnlyChange={() => undefined}
        customize={<button type="button">Customize</button>}
        likelyPassengers={new Set()}
        highlightLikelyPassengers={false}
        onSelect={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a gene" }), {
      target: { value: "TP53" },
    });
    expect(screen.getByText("No pairs match that gene.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("searchbox", { name: "Find a gene" })).toHaveValue("");
  });
});
