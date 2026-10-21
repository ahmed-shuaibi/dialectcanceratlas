import { Button } from "@/components/ui/button";
import { defaultReleaseEntry } from "@/features/atlas/lib/release-catalog";
import type { ReleaseCatalogEntry } from "@/features/atlas/types";

export function ReleaseNotice({ release, onReleaseChange }: {
  release: ReleaseCatalogEntry;
  onReleaseChange: (id: string) => void;
}) {
  const current = defaultReleaseEntry();
  const historical = release.id !== current.id;
  return (
    <section aria-label="Release status" className="site-shell pt-5">
      {historical ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-alert/30 bg-paper px-5 py-4">
          <div>
            <p className="font-semibold text-alert">Historical release · {release.id}</p>
            <p className="mt-1 text-sm text-muted">
              These are earlier results. The current manuscript uses {current.id}.
            </p>
          </div>
          <Button size="sm" onClick={() => onReleaseChange(current.id)}>Open current results</Button>
        </div>
      ) : (
        <p className="text-sm font-semibold text-support">Current manuscript release · {current.id}</p>
      )}
    </section>
  );
}
