import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ChangeCohortButton,
  InitialCohortChooser,
} from "@/features/atlas/components/CohortChooser";
import { releaseEntry } from "@/features/atlas/lib/release-catalog";
import type { CohortMeta } from "@/features/atlas/types";

const k100 = releaseEntry("k100-2026-08-26")!;
const k500 = releaseEntry("k500-2026-09-25")!;

const cohorts: CohortMeta[] = [
  {
    id: "TCGA__CHOL",
    study: "TCGA",
    cohort: "CHOL",
    cancer: "Cholangiocarcinoma",
    n_samples: 36,
    k: 100,
    median_mutations: 42,
    cbio: "https://example.org/tcga-chol",
    data_file: "cohorts/TCGA__CHOL.json",
    data_sha256: "0".repeat(64),
    data_bytes: 1,
  },
  {
    id: "TCGA__BRCA",
    study: "TCGA",
    cohort: "BRCA",
    cancer: "Breast invasive carcinoma",
    n_samples: 1_084,
    k: 100,
    median_mutations: 51,
    cbio: "https://example.org/tcga-brca",
    data_file: "cohorts/TCGA__BRCA.json",
    data_sha256: "1".repeat(64),
    data_bytes: 1,
  },
  {
    id: "MSK-IMPACT__Breast_Cancer",
    study: "MSK-IMPACT",
    cohort: "Breast_Cancer",
    cancer: "Breast cancer",
    n_samples: 4_201,
    k: 100,
    median_mutations: 7,
    cbio: "https://example.org/msk-impact-breast",
    data_file: "cohorts/MSK-IMPACT__Breast_Cancer.json",
    data_sha256: "2".repeat(64),
    data_bytes: 1,
  },
  {
    id: "MSK-CHORD__Pancreatic_Cancer",
    study: "MSK-CHORD",
    cohort: "Pancreatic_Cancer",
    cancer: "Pancreatic cancer",
    n_samples: 211,
    k: 100,
    median_mutations: 6,
    cbio: "https://example.org/msk-chord-pancreatic",
    data_file: "cohorts/MSK-CHORD__Pancreatic_Cancer.json",
    data_sha256: "3".repeat(64),
    data_bytes: 1,
  },
];

describe("CohortChooser study-first contract", () => {
  it("requires a keyboard-operable study choice before exposing cancer types", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<InitialCohortChooser cohorts={cohorts} onSelect={onSelect} release={k100} onReleaseChange={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Choose a study." })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search study or cancer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cholangiocarcinoma/ })).not.toBeInTheDocument();

    const tcga = screen.getByRole("button", { name: /TCGA PanCan Atlas/ });
    tcga.focus();
    expect(tcga).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByText("Choose a cancer type.")).toBeInTheDocument();
    const chol = screen.getByRole("button", {
      name: "Cholangiocarcinoma, CHOL, TCGA PanCan Atlas",
    });
    expect(within(chol).getByText("CHOL")).toBeInTheDocument();

    chol.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("TCGA__CHOL");
  });

  it("shows released cohort identifiers on cancer choices", async () => {
    const user = userEvent.setup();
    render(<InitialCohortChooser cohorts={cohorts} onSelect={vi.fn()} release={k100} onReleaseChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /MSK-IMPACT/ }));
    const breast = screen.getByRole("button", {
      name: "Breast cancer, Breast_Cancer, MSK-IMPACT",
    });
    expect(within(breast).getByText("Breast_Cancer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All studies" }));
    await user.click(screen.getByRole("button", { name: /TCGA PanCan Atlas/ }));
    expect(
      within(
        screen.getByRole("button", {
          name: "Breast invasive carcinoma, BRCA, TCGA PanCan Atlas",
        }),
      ).getByText("BRCA"),
    ).toBeInTheDocument();
  });

  it("opens and closes the change-cohort dialog from the keyboard", async () => {
    const user = userEvent.setup();
    render(<ChangeCohortButton cohorts={cohorts} onSelect={vi.fn()} release={k100} onReleaseChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Change study or cancer" });

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose a cohort" })).toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("routes studies published only in another release to that release", async () => {
    const user = userEvent.setup();
    const onReleaseChange = vi.fn();
    render(
      <InitialCohortChooser
        cohorts={cohorts.filter((cohort) => cohort.study === "TCGA")}
        onSelect={vi.fn()}
        release={k500}
        onReleaseChange={onReleaseChange}
      />,
    );

    expect(screen.getByRole("radio", { name: "K=500 earlier" })).toHaveAttribute("aria-checked", "true");
    const impact = screen.getByRole("button", { name: /MSK-IMPACT/ });
    expect(within(impact).getByText("In the K=100 release")).toBeInTheDocument();
    await user.click(impact);
    expect(onReleaseChange).toHaveBeenCalledWith("k100-2026-08-26");

    await user.click(screen.getByRole("radio", { name: "K=100" }));
    expect(onReleaseChange).toHaveBeenLastCalledWith("k100-2026-08-26");
  });
});
