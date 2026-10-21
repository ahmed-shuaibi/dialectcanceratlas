import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AboutView } from "@/features/atlas/components/AboutView";
import { releaseEntry } from "@/features/atlas/lib/release-catalog";
import type { ReleaseBundle } from "@/features/atlas/types";

const bundle: ReleaseBundle = {
  entry: releaseEntry("k100-2026-08-26")!,
  manifest: {
    release_id: "k100-2026-08-26",
    schema_version: "2.0.0",
    immutable: true,
    generated_at: "2026-08-26T00:00:00Z",
    coverage: { cohorts: 71, samples: 81_257 },
    analysis: {
      top_k_event_features: 100,
      fdr_threshold: 0.01,
      fdr_operator: "<",
      primary_provider: "cbase",
      primary_adjustment: "benjamini-hochberg",
      sensitivity_adjustment: null,
    },
    bmrs: [
      { id: "cbase", label: "CBaSE", role: "primary" },
      { id: "dig", label: "DIG", role: "robustness" },
      { id: "mutsig", label: "MutSigCV2", role: "robustness" },
    ],
    methods: {
      dialect: { directions: ["ME", "CO"] },
      fisher: { directions: ["ME", "CO"] },
      discover: { directions: ["ME", "CO"] },
      megsa: { directions: ["ME"] },
      wesme_wesco: { directions: ["ME", "CO"] },
    },
    index_file: "index.json",
    readme_file: "README.md",
    readme_sha256: "0".repeat(64),
    readme_bytes: 1,
  },
  index: { release_id: "k100-2026-08-26", cohorts: [] },
  likelyPassengers: {
    annotation_id: "likely-passengers-v1",
    schema_version: "1.0.0",
    definition: "Test fixture",
    driver_reference: "drivers.tsv",
    driver_reference_sha256: "1".repeat(64),
    cohorts: {},
  },
};

describe("AboutView content contract", () => {
  it("keeps the title and concise subtitle in one full-width hero, in reading order", () => {
    const { container } = render(<AboutView bundle={bundle} cohort={null} />);
    const title = screen.getByRole("heading", {
      level: 1,
      name: "Find meaningful gene interactions.",
    });
    const subtitle = screen.getByText(
      "DIALECT separates likely passenger mutations from latent driver signal, then identifies gene pairs that occur together less or more often than expected.",
    );
    const hero = title.closest("header");

    expect(hero).not.toBeNull();
    expect(subtitle.closest("header")).toBe(hero);
    expect(Array.from(hero?.children ?? [])).toEqual([title, subtitle]);
    expect(hero).not.toHaveClass("grid");
    expect(container).not.toHaveTextContent(
      /Benjamini|Hochberg|controlling? (?:the )?false discovery rate/i,
    );
  });

  it("labels the immutable release with its shipped scope", () => {
    render(<AboutView bundle={bundle} cohort={null} />);
    const release = screen
      .getByRole("heading", { level: 2, name: "k100-2026-08-26" })
      .closest("section");

    expect(release).not.toBeNull();
    expect(within(release!).getByText("Immutable release")).toBeInTheDocument();
    expect(within(release!).getByText("71")).toBeInTheDocument();
    expect(within(release!).getByText("81,257")).toBeInTheDocument();
    expect(within(release!).getByText("K = 100")).toBeInTheDocument();
    expect(within(release!).getByText("3")).toBeInTheDocument();
    expect(within(release!).getByText("q < 0.01")).toBeInTheDocument();
  });

  it("describes the K=500 revision release as MutSigCV2-primary and TCGA-only", () => {
    const revision: ReleaseBundle = {
      ...bundle,
      entry: releaseEntry("k500-2026-09-25")!,
      manifest: {
        ...bundle.manifest,
        release_id: "k500-2026-09-25",
        schema_version: "3.0.0",
        coverage: { cohorts: 32, samples: 9_000 },
        analysis: {
          top_k_event_features: 500,
          fdr_threshold: 0.01,
          fdr_operator: "<=",
          primary_provider: "mutsig",
          primary_adjustment: "benjamini-yekutieli",
          sensitivity_adjustment: "benjamini-hochberg",
        },
      },
      index: { release_id: "k500-2026-09-25", cohorts: [] },
    };
    render(<AboutView bundle={revision} cohort={null} onReleaseChange={() => undefined} />);
    const release = screen
      .getByRole("heading", { level: 2, name: "k500-2026-09-25" })
      .closest("section");

    expect(within(release!).getByText("K = 500")).toBeInTheDocument();
    expect(within(release!).getByText("BY q ≤ 0.01")).toBeInTheDocument();
    expect(within(release!).getByText(/MSK-IMPACT and MSK-CHORD remain/)).toBeInTheDocument();
    expect(screen.getByText(/MutSigCV2 is primary/)).toBeInTheDocument();
    expect(screen.queryByText(/CBaSE is primary/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "K=500 earlier" })).toHaveAttribute("aria-checked", "true");
  });

  it("groups every equation with a centered visual and aligned footer", () => {
    const { container } = render(<AboutView bundle={bundle} cohort={null} />);
    const formulation = container.querySelector('[aria-labelledby="formulation-heading"] > div');
    const steps = Array.from(container.querySelectorAll(".formulation-step"));

    expect(formulation).toHaveClass("gap-px");
    expect(steps).toHaveLength(3);
    steps.forEach((step) => {
      expect(step).toHaveClass("grid", "grid-rows-[auto_1fr_auto]");
      expect(step.querySelector(".formulation-visual")).toHaveClass(
        "h-40",
        "grid-rows-[1.25rem_1fr]",
      );
      expect(step.querySelector(".formulation-diagram")).not.toBeNull();
      expect(step.lastElementChild).toHaveClass("min-h-24");
    });
  });

  it("operates the method carousel from the keyboard and exposes its state", async () => {
    const user = userEvent.setup();
    render(<AboutView bundle={bundle} cohort={null} />);
    const next = screen.getByRole("button", { name: "Next method" });

    next.focus();
    expect(next).toHaveFocus();
    expect(screen.getByRole("heading", { level: 3, name: "DIALECT" })).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { level: 3, name: "Fisher" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Fisher" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
