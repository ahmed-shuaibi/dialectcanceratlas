import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  LockKeyhole,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ReleaseSwitch } from "@/features/atlas/components/ReleaseSwitch";
import {
  ATLAS_LINKS,
  METHODS,
  bmrMethodsFor,
  isRevisionRelease,
  qCutoffLabel,
} from "@/features/atlas/lib/atlas-metadata";
import {
  cohortUrl,
  indexUrl,
  manifestUrl,
  readmeUrl,
} from "@/features/atlas/lib/atlas-data";
import type { CohortMeta, ReleaseBundle } from "@/features/atlas/types";

function numberFact(value: number): string {
  return value.toLocaleString("en-US");
}

function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      download
      className="focus-ring inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-semibold transition-colors hover:border-ink/25 hover:bg-sand"
    >
      <Download className="size-3.5" aria-hidden />
      {children}
    </a>
  );
}

function CountMatrix() {
  const active = new Set([1, 6, 8, 13, 17, 22]);
  return (
    <div className="grid w-32 grid-cols-6 gap-1" aria-hidden>
      {Array.from({ length: 24 }, (_, index) => (
        <span
          key={index}
          className={active.has(index)
            ? "aspect-square rounded-[4px] bg-brand"
            : "aspect-square rounded-[4px] border border-line bg-canvas"}
        />
      ))}
    </div>
  );
}

function PairState() {
  return (
    <div className="grid grid-cols-2 gap-1.5 font-mono text-xs" aria-hidden>
      {["τ₀₀", "τ₀₁", "τ₁₀", "τ₁₁"].map((label, index) => (
        <span
          key={label}
          className={index === 3
            ? "grid size-12 place-items-center rounded-xl bg-brand text-paper"
            : "grid size-12 place-items-center rounded-xl border border-line bg-canvas text-muted"}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function InteractionPair() {
  return (
    <div className="grid w-44 gap-4" aria-hidden>
      <div className="flex items-center gap-2">
        <span className="size-6 rounded-full border-[6px] border-me-soft bg-me" />
        <span className="h-0.5 flex-1 rounded-full bg-me" />
        <span className="size-6 rounded-full border-[6px] border-me-soft bg-me" />
        <span className="font-mono text-xs font-semibold text-me">ME</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="size-6 rounded-full border-[6px] border-co-soft bg-co" />
        <span className="flex-1 border-t-2 border-dashed border-co" />
        <span className="size-6 rounded-full border-[6px] border-co-soft bg-co" />
        <span className="font-mono text-xs font-semibold text-co">CO</span>
      </div>
    </div>
  );
}

const FORMULATION = [
  {
    label: "Count mutations",
    caption: "Somatic mutation counts by tumor and gene effect.",
    formula: "Cᵢ",
    visual: <CountMatrix />,
  },
  {
    label: "Separate signal",
    caption: "B is background; D is a latent driver state.",
    formula: "Cᵢ = Bᵢ + Dᵢ",
    visual: <PairState />,
  },
  {
    label: "Identify dependencies",
    caption: "ME ranks by ρ; CO ranks by LRT.",
    formula: "τᵤᵥ = P(D=u,D′=v)",
    visual: <InteractionPair />,
  },
] as const;

const CAROUSEL_METHODS = METHODS.filter((method) => method.family !== "Background");

function MethodCarousel() {
  const [index, setIndex] = useState(0);
  const method = CAROUSEL_METHODS[index] ?? CAROUSEL_METHODS[0];
  const move = (delta: number) => {
    setIndex((current) => (current + delta + CAROUSEL_METHODS.length) % CAROUSEL_METHODS.length);
  };
  if (!method) return null;

  return (
    <section aria-labelledby="comparison-methods-heading" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">Comparison methods</p>
          <h2 id="comparison-methods-heading" className="mt-1 text-3xl font-semibold">Different nulls, one cohort.</h2>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="icon" onClick={() => move(-1)} aria-label="Previous method">
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => move(1)} aria-label="Next method">
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      <article className="surface-card view-enter mt-5 grid min-h-64 gap-6 p-6 sm:p-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end" key={method.id} aria-live="polite">
        <div>
          <p className="font-mono text-sm text-muted">
            {String(index + 1).padStart(2, "0")} / {String(CAROUSEL_METHODS.length).padStart(2, "0")}
          </p>
          <p className="mt-10 text-sm font-semibold text-muted">{method.family}</p>
          <h3 className="mt-1 text-[clamp(2.4rem,6vw,4.8rem)] font-semibold leading-none tracking-[-0.05em]">
            {method.label}
          </h3>
        </div>
        <div>
          <p className="max-w-xl text-xl font-medium leading-8 text-muted">{method.summary}</p>
          <a
            href={method.href}
            target="_blank"
            rel="noreferrer"
            className="focus-ring mt-6 inline-flex items-center gap-2 rounded-full text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            Original method <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </article>
      <div className="mt-3 flex justify-center gap-2" aria-label="Choose method">
        {CAROUSEL_METHODS.map((option, optionIndex) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setIndex(optionIndex)}
            aria-label={`Show ${option.label}`}
            aria-pressed={optionIndex === index}
            className={optionIndex === index
              ? "focus-ring h-2.5 w-8 rounded-full bg-ink transition-[width,background-color]"
              : "focus-ring size-2.5 rounded-full bg-line transition-[width,background-color] hover:bg-muted"}
          />
        ))}
      </div>
    </section>
  );
}

export function AboutView({
  bundle,
  cohort,
  onReleaseChange,
}: {
  bundle: ReleaseBundle;
  cohort: CohortMeta | null;
  onReleaseChange?: (id: string) => void;
}) {
  const { coverage, analysis } = bundle.manifest;
  const release = bundle.entry;
  const revision = isRevisionRelease(release);
  const releaseFacts = [
    ["Cohorts", numberFact(coverage.cohorts)],
    ["Tumors", numberFact(coverage.samples)],
    ["Gene-effect cap", `K = ${numberFact(analysis.top_k_event_features)}`],
    ["Backgrounds", String(bundle.manifest.bmrs.length)],
    ["Call rule", `${qCutoffLabel(release)} ${analysis.fdr_threshold}`],
  ];

  return (
    <section className="mx-auto max-w-7xl pb-20 pt-12 sm:pt-16">
      <header>
        <h1 className="max-w-[15ch] text-[clamp(3.1rem,7vw,6.2rem)] font-[650] leading-[0.94] tracking-[-0.05em]">
          Find meaningful gene interactions.
        </h1>
        <p className="mt-7 max-w-4xl text-[clamp(1.2rem,2.3vw,1.65rem)] font-medium leading-[1.55] text-muted">
          DIALECT separates likely passenger mutations from latent driver signal, then identifies gene pairs that occur together less or more often than expected.
        </p>
      </header>

      <section aria-labelledby="formulation-heading" className="mt-12">
        <h2 id="formulation-heading" className="sr-only">DIALECT formulation</h2>
        <div className="grid gap-px overflow-hidden rounded-[28px] border border-line bg-line shadow-soft lg:grid-cols-3">
          {FORMULATION.map((step) =>
            revision && step.label === "Identify dependencies"
              ? { ...step, caption: `One LRT per pair; ρ gives the direction. Ranked by ${release.available_bmrs ? "LRT" : "BY q"}.` }
              : step,
          ).map((step, index) => (
            <article
              key={step.label}
              className="formulation-step grid min-h-80 grid-rows-[auto_1fr_auto] gap-4 bg-paper p-6 sm:p-7"
            >
              <span className="font-mono text-xs text-muted">0{index + 1}</span>
              <div className="formulation-visual grid h-40 w-full grid-rows-[1.25rem_1fr] gap-3">
                <span className="grid place-items-center text-center font-mono text-sm font-medium text-brand">
                  {step.formula}
                </span>
                <div className="formulation-diagram flex items-center justify-center">
                  {step.visual}
                </div>
              </div>
              <div className="min-h-24">
                <h3 className="text-2xl font-semibold">{step.label}</h3>
                <p className="mt-2 text-base leading-7 text-muted">{step.caption}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="backgrounds-heading" className="mt-12">
        <div className="max-w-3xl">
          <h2 id="backgrounds-heading" className="text-3xl font-semibold">Background sensitivity</h2>
          {revision ? (
            <>
              <p className="mt-3 text-lg leading-8 text-muted">
                {release.available_bmrs ? "This release contains the final MutSigCV2 analysis and completed comparison methods. Earlier background comparisons remain available in previous releases." : "MutSigCV2 is primary. CBaSE gives continuity with the original release; DIG tests gene-level sensitivity."}
              </p>
              <p className="mt-1 text-lg leading-8 text-muted">
                {release.available_bmrs ? "All 124,750 pairs among the 500 most mutated loci are tested per cohort, including same-gene M:N pairs." : "Each background is one complete within-cohort test family. Overlap is descriptive, not a vote."}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 text-lg leading-8 text-muted">
                CBaSE is primary. DIG and MutSigCV2 test sensitivity to the background model.
              </p>
              <p className="mt-1 text-lg leading-8 text-muted">
                Consensus defaults to exact pairs with the same direction under all three.
              </p>
            </>
          )}
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {bmrMethodsFor(release).map((method) => (
            <a
              key={method.id}
              href={method.href}
              target="_blank"
              rel="noreferrer"
              className="focus-ring group rounded-[22px] border border-line bg-paper p-5 shadow-sm transition-colors hover:border-ink/25 hover:bg-sand"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-xl font-semibold">{method.label}</span>
                <ExternalLink className="size-4 text-muted group-hover:text-ink" aria-hidden />
              </span>
              <span className="mt-2 block text-base text-muted">{method.summary}</span>
            </a>
          ))}
        </div>
        <p className="mt-4 rounded-[18px] bg-co-soft px-4 py-3 text-base font-medium text-co">
          CO is sensitive to tumor-burden heterogeneity; compare backgrounds.
        </p>
      </section>

      <MethodCarousel />

      <section aria-labelledby="release-heading" className="surface-card mt-12 p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-support">
              <LockKeyhole className="size-3.5" aria-hidden />
              Immutable release
            </div>
            <h2 id="release-heading" className="mt-2 text-2xl font-semibold">
              {bundle.manifest.release_id}
            </h2>
            {revision && (
              <p className="mt-1 text-sm text-muted">
                MSK-IMPACT and MSK-CHORD remain in the K=100 release.
              </p>
            )}
          </div>
          <a
            href={ATLAS_LINKS.source}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-muted underline decoration-line underline-offset-4 hover:text-ink"
          >
            Source code <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>

        {onReleaseChange && (
          <ReleaseSwitch release={release} onChange={onReleaseChange} className="mt-5" />
        )}

        <dl className="mt-6 grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {releaseFacts.map(([label, value]) => (
            <div key={label} className="bg-canvas/65 px-4 py-3">
              <dt className="text-xs font-semibold text-muted">{label}</dt>
              <dd className="mt-1 font-mono text-[15px] font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          <DownloadLink href={manifestUrl(release.id)}>Manifest</DownloadLink>
          <DownloadLink href={indexUrl(bundle)}>Cohort index</DownloadLink>
          <DownloadLink href={readmeUrl(bundle)}>Data dictionary</DownloadLink>
          {cohort && <DownloadLink href={cohortUrl(cohort, release.id)}>Current cohort</DownloadLink>}
        </div>
      </section>
    </section>
  );
}
