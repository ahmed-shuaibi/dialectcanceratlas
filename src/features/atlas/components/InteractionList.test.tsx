import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InteractionList } from "@/features/atlas/components/InteractionList";
import type { DialectRow, InteractionResult } from "@/features/atlas/types";

function result(index: number): InteractionResult {
  const direction = index % 2 === 0 ? "ME" : "CO";
  const row = {
    ga: `A${index}_M`,
    gb: `B${index}_N`,
    direction,
    q: 0.001,
    rank: index + 1,
    rho: direction === "ME" ? -0.3 : 0.3,
    lrt: 8,
  } as DialectRow;
  return {
    id: `${direction}::${row.ga}::${row.gb}`,
    ga: row.ga,
    gb: row.gb,
    direction,
    representative: row,
    matches: [{ bmr: "cbase", row, percentile: (index + 1) / 200 }],
    pairEvidence: [{ bmr: "cbase", row }],
    mutsigFallbackFeatures: [],
    worstPercentile: (index + 1) / 200,
    medianPercentile: (index + 1) / 200,
  };
}

describe("InteractionList", () => {
  it("labels ranked totals separately from significant counts", () => {
    const props = {
      results: [result(0), result(1)], mode: "cbase" as const, qThreshold: 0.01,
      minIdentifiedBmrs: 3 as const, minSignificantBmrs: 3 as const,
      likelyPassengers: new Set<string>(), highlightLikelyPassengers: false,
      onSelect: () => undefined,
    };
    const { rerender } = render(<InteractionList {...props} totals={{ ME: 63, CO: 271 }} />);
    expect(screen.getByText("1 shown / 63 ranked")).toBeInTheDocument();
    expect(screen.getByText("1 shown / 271 ranked")).toBeInTheDocument();
    rerender(<InteractionList {...props} totals={{ ME: 1, CO: 1 }} significantOnly />);
    expect(screen.getAllByText("1 significant pair")).toHaveLength(2);
    expect(screen.queryByText(/ranked/)).not.toBeInTheDocument();
  });

  it("shows both directions and progressively exposes the complete ranked set", async () => {
    const user = userEvent.setup();
    const results = Array.from({ length: 150 }, (_, index) => result(index));
    const { container } = render(
      <InteractionList
        results={results}
        mode="cbase"
        qThreshold={0.01}
        minIdentifiedBmrs={3}
        minSignificantBmrs={3}
        likelyPassengers={new Set()}
        highlightLikelyPassengers={false}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "Mutually exclusive" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Co-occurring" })).toBeInTheDocument();
    expect(screen.queryByText("Significant")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-result-id]")).toHaveLength(120);
    for (const button of screen.getAllByRole("button", { name: "Show 15 more" })) {
      await user.click(button);
    }
    const listIds = [...container.querySelectorAll<HTMLElement>("[data-result-id]")]
      .map((element) => element.dataset.resultId)
      .sort();
    expect(listIds).toEqual(results.map(({ id }) => id).sort());
    expect(listIds).toHaveLength(150);
  });
});
