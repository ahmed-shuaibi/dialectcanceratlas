import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleaseNotice } from "@/features/atlas/components/ReleaseNotice";
import { defaultReleaseEntry, RELEASE_CATALOG } from "@/features/atlas/lib/release-catalog";

describe("ReleaseNotice", () => {
  it("keeps a historical release open and offers the current manuscript release", () => {
    const current = defaultReleaseEntry();
    const historical = RELEASE_CATALOG.find((entry) => entry.id !== current.id)!;
    const change = vi.fn();
    render(<ReleaseNotice release={historical} onReleaseChange={change} />);
    expect(screen.getByText(`Historical release · ${historical.id}`)).toBeInTheDocument();
    expect(screen.getByText(`These are earlier results. The current manuscript uses ${current.id}.`)).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open current results" }));
    expect(change).toHaveBeenCalledWith(current.id);
  });

  it("identifies the current release without offering a redundant switch", () => {
    const current = defaultReleaseEntry();
    render(<ReleaseNotice release={current} onReleaseChange={vi.fn()} />);
    expect(screen.getByText(`Current manuscript release · ${current.id}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open current results" })).not.toBeInTheDocument();
  });
});
