/**
 * Fail-closed validation for an immutable DIALECT Atlas K=500 release (schema 3.0.0).
 *
 * The K=500 release is the complete tested family of the manuscript revision for the
 * 32 TCGA cohorts: gzip-compressed little-endian columnar tables described by each
 * cohort.json. Every compressed and raw byte is hashed, every column's layout is
 * checked, and every summary is recomputed from the decoded rows.
 */

import { validateFinalRelease } from "./validate-final-release.mjs";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";

export const K500_SCHEMA_VERSION = "3.0.0";
const TOP_K = 500;
const BMRS = ["mutsig", "cbase", "dig"];
const BMR_ROLES = { mutsig: "primary", cbase: "continuity", dig: "sensitivity" };
const DIRECTIONS = ["unavailable", "ME", "CO", "neutral"];
const DECISION_THRESHOLDS = [0.001, 0.005, 0.01, 0.05];
const PRIMARY_BIT = 1 << DECISION_THRESHOLDS.indexOf(0.01);
const LOG_TOLERANCE = 1e-12;
const TCGA_COHORTS = [
  "ACC", "BLCA", "BRCA", "CESC", "CHOL", "CRAD", "DLBC", "ESCA", "GBM", "HNSC",
  "KICH", "KIRC", "KIRP", "LAML", "LGG", "LIHC", "LUAD", "LUSC", "MESO", "OV",
  "PAAD", "PCPG", "PRAD", "SARC", "SKCM", "STAD", "TGCT", "THCA", "THYM", "UCEC",
  "UCS", "UVM",
];
const DTYPES = {
  float64: { size: 8, read: (buffer, offset) => buffer.readDoubleLE(offset) },
  uint32: { size: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
  uint16: { size: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
  uint8: { size: 1, read: (buffer, offset) => buffer.readUInt8(offset) },
};
const DTYPE_ORDER = ["float64", "uint32", "uint16", "uint8"];
const PAIR_COLUMNS = [
  ["a", "uint16"],
  ["b", "uint16"],
  ["observed_both", "uint16"],
  ["observed_a_only", "uint16"],
  ["observed_b_only", "uint16"],
  ["observed_neither", "uint16"],
];
const MODEL_COLUMNS = [
  ["lrt", "float64"],
  ["log_p", "float64"],
  ["p", "float64"],
  ["log_by_q", "float64"],
  ["by_q", "float64"],
  ["log_bh_q", "float64"],
  ["bh_q", "float64"],
  ["rho", "float64"],
  ["tau00", "float64"],
  ["tau10", "float64"],
  ["tau01", "float64"],
  ["tau11", "float64"],
  ["log_odds_ratio", "float64"],
  ["wald", "float64"],
  ["null_log_likelihood", "float64"],
  ["alternative_log_likelihood", "float64"],
  ["fit_last_ll_gain", "float64"],
  ["fit_fixed_point_residual", "float64"],
  ["fit_kkt_residual", "float64"],
  ["rank", "uint32"],
  ["fit_iterations", "uint32"],
  ["direction", "uint8"],
  ["identifiability", "uint8"],
  ["effect_reportable", "uint8"],
  ["fit_converged", "uint8"],
  ["by_decisions", "uint8"],
  ["bh_decisions", "uint8"],
];
const BASELINE_COLUMNS = [
  "fisher_me_p", "fisher_co_p", "fisher_me_q", "fisher_co_q",
  "discover_me_p", "discover_co_p", "discover_me_q", "discover_co_q",
  "megsa_lrt", "megsa_p", "megsa_q", "wesme_p", "wesco_p", "wesme_q", "wesco_q",
].map((name) => [name, "float64"]);
const FEATURE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*_[MN]$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readJson(root, relativePath, expected = null) {
  const buffer = await readFile(join(root, relativePath));
  if (expected) {
    assert(sha256(buffer) === expected.sha256, `${relativePath}: SHA-256 mismatch`);
    assert(buffer.length === expected.bytes, `${relativePath}: byte count mismatch`);
  }
  return JSON.parse(buffer.toString("utf8"));
}

function expectedLayout(spec) {
  const ordered = spec
    .map(([name, dtype], position) => ({ name, dtype, position }))
    .sort(
      (a, b) =>
        DTYPE_ORDER.indexOf(a.dtype) - DTYPE_ORDER.indexOf(b.dtype) ||
        a.position - b.position,
    );
  return ordered.map(({ name, dtype }) => ({ name, dtype }));
}

async function readTable(directory, record, spec, rows, label) {
  const compressed = await readFile(join(directory, record.file));
  assert(sha256(compressed) === record.sha256, `${label}: compressed SHA-256 mismatch`);
  assert(compressed.length === record.bytes, `${label}: compressed byte count mismatch`);
  assert(compressed.length <= 25 * 1024 * 1024, `${label}: exceeds the 25 MiB asset limit`);
  const raw = gunzipSync(compressed);
  assert(sha256(raw) === record.raw_sha256, `${label}: raw SHA-256 mismatch`);
  assert(raw.length === record.raw_bytes, `${label}: raw byte count mismatch`);
  assert(record.rows === rows, `${label}: row count mismatch`);
  const layout = expectedLayout(spec);
  assert(record.columns.length === layout.length, `${label}: column count mismatch`);
  const columns = {};
  let offset = 0;
  record.columns.forEach((column, position) => {
    const expected = layout[position];
    assert(
      column.name === expected.name && column.dtype === expected.dtype,
      `${label}: column ${position} is ${column.name}:${column.dtype}, expected ${expected.name}:${expected.dtype}`,
    );
    const dtype = DTYPES[column.dtype];
    assert(column.offset === offset, `${label}/${column.name}: unexpected offset`);
    assert(offset % dtype.size === 0, `${label}/${column.name}: misaligned column`);
    const values = new Array(rows);
    for (let row = 0; row < rows; row += 1) values[row] = dtype.read(raw, offset + row * dtype.size);
    columns[column.name] = values;
    offset += rows * dtype.size;
  });
  assert(offset === raw.length, `${label}: table has unaccounted bytes`);
  return columns;
}

function validateManifest(manifest, releaseId) {
  assert(manifest.release_id === releaseId, "manifest release_id does not match its directory");
  assert(manifest.schema_version === K500_SCHEMA_VERSION, "manifest schema is not 3.0.0");
  assert(manifest.immutable === true, "manifest is not immutable");
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.generated_at), "invalid generated_at");
  const analysis = manifest.analysis;
  assert(analysis.top_k_event_features === TOP_K, "analysis K is not 500");
  assert(analysis.primary_provider === "mutsig", "primary provider is not MutSigCV2");
  assert(analysis.primary_adjustment === "benjamini-yekutieli", "primary adjustment is not BY");
  assert(analysis.sensitivity_adjustment === "benjamini-hochberg", "sensitivity is not BH");
  assert(analysis.primary_q_threshold === 0.01 && analysis.fdr_threshold === 0.01, "threshold drift");
  assert(analysis.fdr_operator === "<=", "threshold comparison must be inclusive");
  assert(
    JSON.stringify(analysis.decision_thresholds) === JSON.stringify(DECISION_THRESHOLDS),
    "decision thresholds drift",
  );
  assert(analysis.calibration?.gate?.overall_gate_pass === true, "calibration gate did not pass");
  assert(
    analysis.provider_overlap === "descriptive-only-not-an-inferential-vote",
    "provider overlap must be descriptive",
  );
  assert(
    JSON.stringify(manifest.bmrs.map(({ id, role }) => [id, role])) ===
      JSON.stringify(BMRS.map((bmr) => [bmr, BMR_ROLES[bmr]])),
    "background roles drift",
  );
  assert(manifest.encoding?.format === "columnar-little-endian-gzip-v1", "unknown encoding");
  assert(manifest.coverage.cohorts === TCGA_COHORTS.length, "coverage is not 32 TCGA cohorts");
  assert(
    JSON.stringify(manifest.coverage.studies) === JSON.stringify({ TCGA: TCGA_COHORTS.length }),
    "K=500 release must contain TCGA only",
  );
  for (const method of ["dialect", "fisher", "discover", "megsa", "wesme_wesco"]) {
    assert(Array.isArray(manifest.methods?.[method]?.directions), `missing method ${method}`);
  }
}

function crossingSummary(model, bitsKey) {
  const summary = { total: 0, ME: 0, CO: 0, direction_unavailable: 0 };
  model[bitsKey].forEach((bits, row) => {
    if (!(bits & PRIMARY_BIT)) return;
    summary.total += 1;
    const label = DIRECTIONS[model.direction[row]];
    if (label === "ME" || label === "CO") summary[label] += 1;
    else summary.direction_unavailable += 1;
  });
  return summary;
}

function validateModel(model, cohort, label) {
  const identifiability = cohort.enums.identifiability;
  const fullRank = identifiability.indexOf("full-affine-rank");
  const rows = model.lrt.length;
  const ranks = { ME: [], CO: [] };
  for (let row = 0; row < rows; row += 1) {
    for (const name of ["lrt", "log_p", "p", "log_by_q", "by_q", "log_bh_q", "bh_q"]) {
      assert(Number.isFinite(model[name][row]), `${label}: non-finite ${name} at ${row}`);
    }
    assert(model.lrt[row] >= 0, `${label}: negative LRT at ${row}`);
    for (const name of ["log_p", "log_by_q", "log_bh_q"]) {
      assert(model[name][row] <= 0, `${label}: positive ${name} at ${row}`);
    }
    for (const name of ["p", "by_q", "bh_q"]) {
      assert(model[name][row] >= 0 && model[name][row] <= 1, `${label}: ${name} outside [0, 1]`);
    }
    assert(model.log_by_q[row] >= model.log_bh_q[row] - LOG_TOLERANCE, `${label}: BY below BH`);
    for (const [key, logKey] of [["by_decisions", "log_by_q"], ["bh_decisions", "log_bh_q"]]) {
      const bits = model[key][row];
      assert(bits < 1 << DECISION_THRESHOLDS.length, `${label}: invalid ${key}`);
      DECISION_THRESHOLDS.forEach((threshold, bit) => {
        const bound = Math.log(threshold);
        const logQ = model[logKey][row];
        if (bits & (1 << bit)) assert(logQ <= bound + LOG_TOLERANCE, `${label}: ${key} bit ${bit} set above threshold`);
        else assert(logQ > bound - LOG_TOLERANCE, `${label}: ${key} bit ${bit} unset below threshold`);
      });
      for (let bit = 1; bit < DECISION_THRESHOLDS.length; bit += 1) {
        if (bits & (1 << (bit - 1))) assert(bits & (1 << bit), `${label}: non-monotone ${key}`);
      }
    }
    const direction = DIRECTIONS[model.direction[row]];
    assert(direction != null, `${label}: invalid direction code`);
    const rho = model.rho[row];
    const expected = Number.isNaN(rho) ? "unavailable" : rho < 0 ? "ME" : rho > 0 ? "CO" : "neutral";
    assert(direction === expected, `${label}: direction is not the rho sign at ${row}`);
    assert(model.identifiability[row] < identifiability.length, `${label}: invalid identifiability`);
    const reportable = model.identifiability[row] === fullRank;
    assert(model.effect_reportable[row] === (reportable ? 1 : 0), `${label}: reportable flag drift`);
    if (!reportable) {
      assert(Number.isNaN(rho), `${label}: non-identifiable pair reports rho`);
      assert(model.log_p[row] === 0 && model.p[row] === 1, `${label}: non-identifiable p is not 1`);
    }
    if (!Number.isNaN(rho)) assert(Math.abs(rho) <= 1 + 1e-9, `${label}: rho outside [-1, 1]`);
    for (const name of ["tau00", "tau10", "tau01", "tau11"]) {
      assert(model[name][row] >= -1e-10 && model[name][row] <= 1 + 1e-10, `${label}: ${name} outside [0, 1]`);
    }
    assert(model.fit_converged[row] === 1, `${label}: unconverged fit at ${row}`);
    if (direction === "ME" || direction === "CO") ranks[direction].push(model.rank[row]);
    else assert(model.rank[row] === 0, `${label}: non-directional row has a rank`);
  }
  for (const direction of ["ME", "CO"]) {
    const sorted = [...ranks[direction]].sort((a, b) => a - b);
    sorted.forEach((rank, index) => assert(rank === index + 1, `${label}: ${direction} ranks are not 1..n`));
  }
}

function assertSummary(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: summary mismatch`);
}

async function validateCohort(root, record, position) {
  const cohortId = `TCGA__${TCGA_COHORTS[position]}`;
  assert(record.id === cohortId, `index cohort ${position} is ${record.id}, expected ${cohortId}`);
  assert(record.study === "TCGA" && record.k === TOP_K, `${cohortId}: study/K drift`);
  assert(record.data_file === `cohorts/${cohortId}/cohort.json`, `${cohortId}: unexpected data_file`);
  const cohort = await readJson(root, record.data_file, {
    sha256: record.data_sha256,
    bytes: record.data_bytes,
  });
  assert(cohort.id === cohortId && cohort.k === TOP_K, `${cohortId}: cohort identity drift`);
  assert(cohort.n_samples === record.n_samples, `${cohortId}: sample count drift`);
  const features = cohort.features;
  assert(features.length === TOP_K && new Set(features).size === TOP_K, `${cohortId}: not 500 unique features`);
  assert(features.every((feature) => FEATURE_PATTERN.test(feature)), `${cohortId}: unsafe feature ID`);
  assert(
    JSON.stringify(Object.keys(cohort.tables)) === JSON.stringify(["pairs", ...BMRS, "baselines"]),
    `${cohortId}: unexpected table set`,
  );
  assert(JSON.stringify(cohort.enums.direction) === JSON.stringify(DIRECTIONS), `${cohortId}: direction enum drift`);
  const rows = cohort.pair_policy.tested_pairs;
  const directory = join(root, "cohorts", cohortId);
  const tableBytes = Object.values(cohort.tables).reduce((sum, table) => sum + table.bytes, 0);
  assert(tableBytes === record.table_bytes, `${cohortId}: table byte total drift`);

  const pairs = await readTable(directory, cohort.tables.pairs, PAIR_COLUMNS, rows, `${cohortId}/pairs`);
  const base = features.map((feature) => feature.replace(/_[MN]$/, ""));
  let sameBase = 0;
  for (let a = 0; a < TOP_K; a += 1) {
    for (let b = a + 1; b < TOP_K; b += 1) if (base[a] === base[b]) sameBase += 1;
  }
  assert(sameBase === cohort.pair_policy.same_base_pairs_excluded, `${cohortId}: same-base count drift`);
  assert(rows === (TOP_K * (TOP_K - 1)) / 2 - sameBase, `${cohortId}: tested pair count drift`);
  let previous = -1;
  for (let row = 0; row < rows; row += 1) {
    const a = pairs.a[row];
    const b = pairs.b[row];
    assert(a < b && b < TOP_K, `${cohortId}: invalid pair indices at ${row}`);
    assert(base[a] !== base[b], `${cohortId}: same-base pair published at ${row}`);
    const key = a * TOP_K + b;
    assert(key > previous, `${cohortId}: pairs are not in canonical order`);
    previous = key;
    const total =
      pairs.observed_both[row] + pairs.observed_a_only[row] +
      pairs.observed_b_only[row] + pairs.observed_neither[row];
    assert(total === cohort.n_samples, `${cohortId}: contingency does not sum to n at ${row}`);
  }

  const models = {};
  for (const bmr of BMRS) {
    const model = await readTable(directory, cohort.tables[bmr], MODEL_COLUMNS, rows, `${cohortId}/${bmr}`);
    validateModel(model, cohort, `${cohortId}/${bmr}`);
    const summary = cohort.summaries.models[bmr];
    assertSummary(crossingSummary(model, "by_decisions"), summary.by_q_le_0_01, `${cohortId}/${bmr}/BY`);
    assertSummary(crossingSummary(model, "bh_decisions"), summary.bh_q_le_0_01, `${cohortId}/${bmr}/BH`);
    assert(summary.tested_pairs === rows, `${cohortId}/${bmr}: tested pair summary drift`);
    assertSummary(summary, record.model_summaries[bmr], `${cohortId}/${bmr}/index`);
    models[bmr] = model;
  }

  const baselines = await readTable(directory, cohort.tables.baselines, BASELINE_COLUMNS, rows, `${cohortId}/baselines`);
  for (const [name] of BASELINE_COLUMNS) {
    baselines[name].forEach((value, row) => {
      assert(Number.isFinite(value), `${cohortId}/baselines: non-finite ${name} at ${row}`);
      if (name !== "megsa_lrt") assert(value >= 0 && value <= 1, `${cohortId}/baselines: ${name} outside [0, 1]`);
    });
  }
  assertSummary(cohort.summaries.baselines, record.baseline_summary, `${cohortId}/baseline index`);
  return { cohort, pairs, models };
}

function topMe(result) {
  const { cohort, pairs, models } = result;
  return BMRS.map((bmr) => {
    const row = models[bmr].rank.findIndex(
      (rank, index) => rank === 1 && DIRECTIONS[models[bmr].direction[index]] === "ME",
    );
    return [cohort.features[pairs.a[row]], cohort.features[pairs.b[row]]].sort().join(":");
  });
}

export async function validateK500Release(root, releaseId) {
  const manifest = await readJson(root, "manifest.json");
  if (manifest.analysis?.contract === "final-v5-all-pairs-chi3-by") {
    return validateFinalRelease(root, manifest);
  }
  validateManifest(manifest, releaseId);
  const index = await readJson(root, manifest.index_file, {
    sha256: manifest.index_sha256,
    bytes: manifest.index_bytes,
  });
  const readme = await readFile(join(root, manifest.readme_file));
  assert(sha256(readme) === manifest.readme_sha256, "README SHA-256 mismatch");
  assert(index.release_id === releaseId, "index release_id mismatch");
  assert(index.cohorts.length === TCGA_COHORTS.length, "index does not list 32 cohorts");
  const topLevel = (await readdir(root)).sort();
  assert(
    JSON.stringify(topLevel) === JSON.stringify(["README.md", "cohorts", "index.json", "manifest.json"]),
    `unexpected top-level release files: ${topLevel.join(", ")}`,
  );
  const cohortDirectories = (await readdir(join(root, "cohorts"))).sort();
  assert(
    JSON.stringify(cohortDirectories) === JSON.stringify(TCGA_COHORTS.map((cohort) => `TCGA__${cohort}`)),
    "cohort directories do not match the 32 TCGA cohorts",
  );

  let samples = 0;
  let pairsPerModel = 0;
  const rejections = { ME: 0, CO: 0, direction_unavailable: 0 };
  let chol = null;
  for (const [position, record] of index.cohorts.entries()) {
    const files = (await readdir(join(root, "cohorts", record.id))).sort();
    assert(
      JSON.stringify(files) === JSON.stringify([
        "baselines.bin.gz", "cohort.json", "dialect-cbase.bin.gz", "dialect-dig.bin.gz",
        "dialect-mutsig.bin.gz", "pairs.bin.gz",
      ]),
      `${record.id}: unexpected files ${files.join(", ")}`,
    );
    const result = await validateCohort(root, record, position);
    samples += record.n_samples;
    pairsPerModel += result.cohort.pair_policy.tested_pairs;
    const primary = result.cohort.summaries.models.mutsig.by_q_le_0_01;
    for (const key of Object.keys(rejections)) rejections[key] += primary[key];
    if (record.id === "TCGA__CHOL") chol = result;
    if ((position + 1) % 8 === 0) {
      process.stdout.write(`validated ${position + 1}/${index.cohorts.length} K=500 cohorts\n`);
    }
  }
  assert(samples === manifest.coverage.samples, "sample coverage mismatch");
  assert(pairsPerModel === manifest.coverage.tested_pairs_per_model, "pair coverage mismatch");
  assert(
    JSON.stringify(rejections) === JSON.stringify(manifest.coverage.mutsig_primary_rejections),
    "primary rejection coverage mismatch",
  );
  const cholTop = topMe(chol);
  assert(
    cholTop.every((pair) => pair === "IDH1_M:PBRM1_N"),
    `CHOL top-ME regression failed: ${cholTop.join(", ")}`,
  );
  process.stdout.write(
    `release ${releaseId} valid: ${index.cohorts.length} cohorts, ${samples.toLocaleString()} samples, ` +
      `${(pairsPerModel * BMRS.length).toLocaleString()} DIALECT rows, ` +
      `${pairsPerModel.toLocaleString()} baseline rows, ` +
      `${(rejections.ME + rejections.CO + rejections.direction_unavailable).toLocaleString()} MutSigCV2 BY rejections\n`,
  );
  return { cohorts: index.cohorts.length, samples, pairsPerModel, rejections };
}
