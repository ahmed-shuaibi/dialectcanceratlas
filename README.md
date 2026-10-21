# DIALECT Atlas

The visual companion to DIALECT, a latent-variable method for evaluating mutual
exclusivity and co-occurrence between somatic gene-effect pairs in cancer.

[Explore the Atlas](https://dialectcanceratlas.com/)

Choose a study, then a cancer type. Explore ranked mutually exclusive and
co-occurring interactions in one list or an interactive network, or compare
DIALECT with Fisher, DISCOVER, MEGSA, WeSME, and WeSCO.

The Atlas serves three immutable releases side by side:

- **`k500-2026-10-20`** (default): the final manuscript results for 10,433 tumors
  across 32 TCGA cohorts. All 124,750 pairs of the 500 most mutated loci are included
  per cohort, including same-gene M:N pairs. MutSigCV2 is primary; the final
  chi-square reference has 3 degrees of freedom, with BY `q ≤ 0.05` (8 ME and
  4 CO calls). Completed Fisher, DISCOVER, MEGSA and WeSME/WeSCO scores use the same
  locus and sample sets. The export verifies final Table S5 and the ranked network
  and biological figure source tables. See the release `verification.json`.
- **`k500-2026-09-25`**: the earlier revision analysis. Every unordered pair of
  the frozen 500-feature axis in each of the 32 TCGA PanCan Atlas cohorts, under
  MutSigCV2 (primary), CBaSE (continuity), and DIG (sensitivity). Each background is
  one complete within-cohort family; calls use Benjamini-Yekutieli `q ≤ cutoff`
  (primary 0.01), Benjamini-Hochberg is reported as a sensitivity, and cross-background
  overlap is descriptive only. Tables are columnar gzip shards.
- **`k100-2026-08-26`**: the original release. Every evaluated pair from up to 100
  count-ranked features in each of 71 TCGA, MSK-IMPACT, and MSK-CHORD cohorts. Its
  default view requires agreement under all three backgrounds with strict BH `q <`.
  MSK cohorts are only in this release.

Every release file is immutable and SHA-256 verified during deployment. A separate, versioned annotation sidecar identifies the exact
count-ranked, non-OncoKB event features that can be highlighted as likely
passengers without modifying the published release.

The final release is assembled from completed, hash-verified source tables only:

```bash
python scripts/export-final-results.py --source /path/to/dialect \
  --manuscript /path/to/collaborator_revision_20261009_v5 \
  --release-id k500-2026-10-20
```

This command refuses an existing release directory and does not fit models or run simulations.

## Local development

```bash
npm ci
npm run check
npm run dev
```

The production build targets `https://dialectcanceratlas.com` at the site root.
Cloudflare Pages and the CI workflow set the same values explicitly. The build
validates rendered metadata, asset paths, security headers, and release files:

```bash
ATLAS_BASE_PATH=/ ATLAS_SITE_URL=https://dialectcanceratlas.com npm run build
```

Cloudflare Pages project `dialect-cancer-atlas` deploys `main`; GitHub Actions is
CI-only and GitHub Pages is retired. See
[`docs/custom-domain.md`](docs/custom-domain.md) for the build, routing, security,
redirect, and rollback contract.

The release schema, provenance, thresholds, and field definitions are documented
inside each release's `README.md` under `public/data/releases/`. The release
catalog is `src/features/atlas/release-catalog.json`.

## Cite

```bibtex
@article{shuaibi2024dialect,
  author  = {Ahmed Shuaibi and Uthsav Chitra and Benjamin J. Raphael},
  title   = {A latent variable model for evaluating mutual exclusivity and
             co-occurrence between driver mutations in cancer},
  journal = {bioRxiv},
  year    = {2024},
  doi     = {10.1101/2024.04.24.590995}
}
```

BSD-3-Clause. See [LICENSE](LICENSE).
