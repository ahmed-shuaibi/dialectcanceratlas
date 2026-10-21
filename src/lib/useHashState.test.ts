import { describe, expect, it } from "vitest";
import { parseAtlasHash, serializeAtlasHash, URL_DEFAULTS } from "@/lib/useHashState";

describe("Atlas hash state", () => {
  it("starts cancer-free in the ranked list view", () => {
    expect(parseAtlasHash("")).toEqual(URL_DEFAULTS);
    expect(parseAtlasHash("").cohort).toBeUndefined();
    expect(parseAtlasHash("")).toMatchObject({
      release: "k500-2026-10-20",
      mode: "mutsig",
      exploreDisplay: "list",
      qThreshold: 0.05,
      significantOnly: false,
    });
  });

  it("round-trips every addressable view state", () => {
    const state = {
      release: "k100-2026-08-26",
      view: "compare" as const,
      cohort: "TCGA__LUAD",
      mode: "mutsig" as const,
      pair: "ME::KRAS_M::TP53_N",
      settings: true,
      exploreDisplay: "network" as const,
      qThreshold: 0.005 as const,
      minIdentifiedBmrs: 2 as const,
      minSignificantBmrs: 1 as const,
      significantOnly: true,
      compareDirection: "CO" as const,
      highlightLikelyPassengers: true,
    };
    expect(parseAtlasHash(serializeAtlasHash(state))).toEqual(state);
  });

  it("coerces invalid enums, q cutoffs, and BMR counts to safe defaults", () => {
    const parsed = parseAtlasHash(
      "#view=nope&mode=nope&settings=0&display=nope&q=0.02&identify=0&sigbmrs=4&significant=nope",
    );
    expect(parsed).toEqual(URL_DEFAULTS);
  });

  it("omits default filters while preserving non-default q and significance state", () => {
    expect(serializeAtlasHash(URL_DEFAULTS)).toBe(
      "#release=k500-2026-10-20&view=explore&mode=mutsig&display=list",
    );
    expect(
      serializeAtlasHash({
        ...URL_DEFAULTS,
        qThreshold: 0.01,
        minIdentifiedBmrs: 2,
        minSignificantBmrs: 1,
        significantOnly: true,
      }),
    ).toBe(
      "#release=k500-2026-10-20&view=explore&mode=mutsig&display=list&q=0.01&identify=2&sigbmrs=1&significant=1",
    );
  });

  it("keeps identification and significance minima independent", () => {
    expect(parseAtlasHash("#identify=1&sigbmrs=2")).toMatchObject({
      minIdentifiedBmrs: 1,
      minSignificantBmrs: 2,
    });
    expect(parseAtlasHash("#identify=2&sigbmrs=1")).toMatchObject({
      minIdentifiedBmrs: 2,
      minSignificantBmrs: 1,
    });
    expect(parseAtlasHash("#identify=3&sigbmrs=3")).toMatchObject({
      minIdentifiedBmrs: 3,
      minSignificantBmrs: 3,
    });
  });

  it("ignores removed settings while preserving the comparison direction", () => {
    const parsed = parseAtlasHash(
      "#view=explore&cohort=TCGA__LUAD&mode=consensus&strict=1&direction=CO&compare=ME",
    );
    expect(parsed).toEqual({
      ...URL_DEFAULTS,
      cohort: "TCGA__LUAD",
      mode: "mutsig",
      compareDirection: "CO",
    });
    const serialized = serializeAtlasHash(parsed);
    expect(serialized).not.toContain("strict");
    expect(serialized).toContain("direction=CO");
    expect(serialized).not.toContain("compare");
  });

  it("resolves each link to the release that publishes its cohort", () => {
    expect(parseAtlasHash("#cohort=TCGA__CHOL")).toMatchObject({
      release: "k500-2026-10-20",
      mode: "mutsig",
    });
    expect(parseAtlasHash("#cohort=MSK-IMPACT__BRCA")).toMatchObject({
      release: "k100-2026-08-26",
      mode: "consensus",
    });
    expect(parseAtlasHash("#release=k100-2026-08-26&cohort=TCGA__CHOL").release).toBe(
      "k100-2026-08-26",
    );
    expect(parseAtlasHash("#release=k999-nope").release).toBe("k500-2026-10-20");
  });

  it("preserves historical thresholds and rejects unavailable backgrounds", () => {
    expect(parseAtlasHash("#release=k500-2026-09-25").qThreshold).toBe(0.01);
    expect(parseAtlasHash("#mode=cbase").mode).toBe("mutsig");
    expect(parseAtlasHash("#q=0.01").qThreshold).toBe(0.01);
  });

  it("supports contact and paper-faithful passenger annotations", () => {
    const parsed = parseAtlasHash("#view=contact&passengers=1");
    expect(parsed.view).toBe("contact");
    expect(parsed.highlightLikelyPassengers).toBe(true);
    expect(serializeAtlasHash(parsed)).toContain("passengers=1");
  });
});
