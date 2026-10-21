import {
  decodeColumnarCohort,
  decodeColumnarCohortFile,
  gunzipIfNeeded,
} from "@/features/atlas/lib/columnar";
import {
  decodeCohort,
  decodeIndex,
  decodeLikelyPassengerAnnotations,
  decodeManifest,
} from "@/features/atlas/lib/decode";
import {
  DEFAULT_RELEASE_ID,
  isColumnarRelease,
  releaseEntry,
} from "@/features/atlas/lib/release-catalog";
import type {
  CohortData,
  CohortMeta,
  ReleaseBundle,
  ReleaseCatalogEntry,
} from "@/features/atlas/types";

export const LIKELY_PASSENGERS_URL = `${import.meta.env.BASE_URL}data/annotations/likely-passengers-v1.json`;
const COHORT_CACHE_LIMIT = 3;
/** A decoded K=500 cohort holds up to ~80 MB of typed arrays; keep only the current one. */
const COLUMNAR_CACHE_LIMIT = 1;

const releaseValues = new Map<string, ReleaseBundle>();
const releasePromises = new Map<string, Promise<ReleaseBundle>>();
const cohortValues = new Map<string, CohortData>();
const cohortPromises = new Map<string, Promise<CohortData>>();

const relative = (path: string) => path.replace(/^\.\//, "").replace(/^\//, "");

export function releaseRoot(releaseId: string = DEFAULT_RELEASE_ID): string {
  return `${import.meta.env.BASE_URL}data/releases/${releaseId}/`;
}

async function fetchOk(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, { headers: { Accept: accept } });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return response;
}

async function fetchJson(url: string): Promise<unknown> {
  return (await fetchOk(url, "application/json")).json();
}

async function fetchTable(url: string): Promise<ArrayBuffer> {
  return gunzipIfNeeded(await (await fetchOk(url, "application/octet-stream")).arrayBuffer());
}

function requireEntry(releaseId: string): ReleaseCatalogEntry {
  const entry = releaseEntry(releaseId);
  if (!entry) throw new Error(`Unknown Atlas release ${releaseId}`);
  return entry;
}

export function manifestUrl(releaseId: string = DEFAULT_RELEASE_ID): string {
  return `${releaseRoot(releaseId)}manifest.json`;
}

export async function loadRelease(releaseId: string = DEFAULT_RELEASE_ID): Promise<ReleaseBundle> {
  const cached = releaseValues.get(releaseId);
  if (cached) return cached;
  const pending = releasePromises.get(releaseId);
  if (pending) return pending;

  const promise = (async () => {
    const entry = requireEntry(releaseId);
    const manifest = decodeManifest(await fetchJson(manifestUrl(releaseId)));
    if (
      manifest.release_id !== entry.id ||
      manifest.schema_version !== entry.schema_version ||
      manifest.analysis.top_k_event_features !== entry.k ||
      !manifest.immutable
    ) {
      throw new Error(
        `Unexpected release contract: ${manifest.release_id} schema ${manifest.schema_version}`,
      );
    }
    const [index, likelyPassengers] = await Promise.all([
      fetchJson(`${releaseRoot(releaseId)}${relative(manifest.index_file)}`).then(decodeIndex),
      fetchJson(entry.annotation_file ? `${releaseRoot(releaseId)}${entry.annotation_file}` : LIKELY_PASSENGERS_URL).then(decodeLikelyPassengerAnnotations),
    ]);
    if (index.release_id !== manifest.release_id) {
      throw new Error(
        `Release mismatch: manifest ${manifest.release_id}, index ${index.release_id}`,
      );
    }
    const missingAnnotations = index.cohorts
      .map(({ id }) => id)
      .filter((id) => likelyPassengers.cohorts[id] == null);
    if (missingAnnotations.length > 0) {
      throw new Error(`Missing likely-passenger annotations: ${missingAnnotations.join(", ")}`);
    }
    const bundle: ReleaseBundle = { entry, manifest, index, likelyPassengers };
    releaseValues.set(releaseId, bundle);
    return bundle;
  })().finally(() => {
    releasePromises.delete(releaseId);
  });
  releasePromises.set(releaseId, promise);
  return promise;
}

async function fetchColumnarCohort(releaseId: string, meta: CohortMeta): Promise<CohortData> {
  const cohortFile = cohortUrl(meta, releaseId);
  const cohort = decodeColumnarCohortFile(await fetchJson(cohortFile));
  const directory = cohortFile.slice(0, cohortFile.lastIndexOf("/") + 1);
  const entries = await Promise.all(
    Object.entries(cohort.tables).map(async ([name, table]) =>
      [name, await fetchTable(`${directory}${relative(table.file)}`)] as const,
    ),
  );
  return decodeColumnarCohort(meta, cohort, Object.fromEntries(entries));
}

export async function loadCohort(
  meta: CohortMeta,
  releaseId: string = DEFAULT_RELEASE_ID,
): Promise<CohortData> {
  const key = `${releaseId}/${meta.id}`;
  const cached = cohortValues.get(key);
  if (cached) return cached;
  const pending = cohortPromises.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const entry = requireEntry(releaseId);
    const decoded = isColumnarRelease(entry)
      ? await fetchColumnarCohort(releaseId, meta)
      : decodeCohort(await fetchJson(cohortUrl(meta, releaseId)));
    if (decoded.id !== meta.id) {
      throw new Error(`Cohort mismatch: index ${meta.id}, file ${decoded.id}`);
    }
    cohortValues.delete(key);
    cohortValues.set(key, decoded);
    const limit = isColumnarRelease(entry) ? COLUMNAR_CACHE_LIMIT : COHORT_CACHE_LIMIT;
    while (cohortValues.size > limit) {
      const oldest = cohortValues.keys().next().value as string | undefined;
      if (!oldest) break;
      cohortValues.delete(oldest);
    }
    return decoded;
  })().finally(() => {
    // Do not let settled promises bypass the bounded decoded-cohort cache.
    cohortPromises.delete(key);
  });
  cohortPromises.set(key, promise);
  return promise;
}

export function indexUrl(bundle: ReleaseBundle): string {
  return `${releaseRoot(bundle.entry.id)}${relative(bundle.manifest.index_file)}`;
}

export function cohortUrl(meta: CohortMeta, releaseId: string = DEFAULT_RELEASE_ID): string {
  return `${releaseRoot(releaseId)}${relative(meta.data_file)}`;
}

export function readmeUrl(bundle: ReleaseBundle): string {
  return `${releaseRoot(bundle.entry.id)}${relative(bundle.manifest.readme_file)}`;
}

/** Test/retry seam. A failed immutable fetch is never retained. */
export function clearAtlasCache(): void {
  releaseValues.clear();
  releasePromises.clear();
  cohortValues.clear();
  cohortPromises.clear();
}
