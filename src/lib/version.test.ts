import { describe, expect, it } from "bun:test";
import {
  coerceToSemVer,
  findValidVersionInStrings,
  maybeSemverRange,
  parseVersionParams,
} from "./version";
import semver, { SemVer } from "semver";
import assert from "node:assert/strict";

describe("maybeSemverRange", () => {
  it("returns true for potential semver range", () => {
    expect(maybeSemverRange("1.x")).toBe(true);
    expect(maybeSemverRange(">1")).toBe(true);
    expect(maybeSemverRange(">=0.2.3")).toBe(true);
    expect(maybeSemverRange("^0.2.3")).toBe(true);
    expect(maybeSemverRange("~0.2.3")).toBe(true);
  });

  it("returns false for fixed version", () => {
    expect(maybeSemverRange("1.2.3")).toBe(false);
    expect(maybeSemverRange("1.2")).toBe(false);
    expect(maybeSemverRange("1")).toBe(false);
  });
});

describe("coerceToSemVer", () => {
  it("returns null for invalid version", () => {
    expect(coerceToSemVer(null)).toBe(null);
    expect(coerceToSemVer("")).toBe(null);
    expect(coerceToSemVer("abc")).toBe(null);
    expect(coerceToSemVer("a.b.c")).toBe(null);
  });

  it("returns SemVer for valid version", () => {
    expect(coerceToSemVer("1.2.3")).toBeInstanceOf(SemVer);
    expect(coerceToSemVer("1.2.3")?.toString()).toBe("1.2.3");
    expect(coerceToSemVer("1")?.toString()).toBe("1.0.0");
    expect(coerceToSemVer("1.3")?.toString()).toBe("1.3.0");
  });

  it("includes prerelease", () => {
    expect(coerceToSemVer("1.2.3-beta")).toBeInstanceOf(SemVer);
    expect(coerceToSemVer("1.2.3-beta")?.toString()).toBe("1.2.3-beta");
  });
});

describe("findValidVersionInStrings", () => {
  it("finds and coerces a semver version in strings", () => {
    expect(
      findValidVersionInStrings(["hello world", "release: v3.2"])?.toString()
    ).toBe("3.2.0");
  });
  it("returns null for invalid versions", () => {
    expect(findValidVersionInStrings(["abc", "def"])).toBe(null);
  });
});

describe("parseVersionParams", () => {
  it("parses specific version", () => {
    const params = parseVersionParams("1.2");
    expect(params.type).toBe("ref");

    expect(params).toEqual({
      type: "ref",
      ref: "1.2",
    });
  });

  it("parses specific range", () => {
    const params = parseVersionParams(">=1.2.3");
    expect(params).toEqual({
      type: "ref",
      ref: ">=1.2.3",
    });
  });

  it("parses from", () => {
    const params = parseVersionParams("3..");

    expect(params.type).toBe("range");
    assert(params.type === "range");

    expect(params.from.value).toBeInstanceOf(SemVer);
    expect(params.from.value?.toString()).toBe("3.0.0");
    expect(params.from.excluding).toBeUndefined();

    expect(params.to.value).toBe(null);
  });

  it("parses to", () => {
    const params = parseVersionParams("..3");

    expect(params.type).toBe("range");
    assert(params.type === "range");

    expect(params.from.value).toBe(null);

    expect(params.to.value).toBeInstanceOf(SemVer);
    expect(params.to.value?.toString()).toBe("3.0.0");
  });

  it("parses to with semver range", () => {
    const params = parseVersionParams("..3.x");

    expect(params.type).toBe("range");
    assert(params.type === "range");

    expect(params.from.value).toBe(null);

    expect(params.to.value).toBeInstanceOf(SemVer);
    expect(params.to.raw).toBe("3.x");
    expect(params.to.range).toBe(">=3.0.0 <4.0.0-0");

    expect(semver.satisfies("3.2.1", params.to.range!)).toBeTrue();
  });

  it("parses from and to", () => {
    const params = parseVersionParams("1.2..3");

    expect(params.type).toBe("range");
    assert(params.type === "range");

    expect(params.from.value).toBeInstanceOf(SemVer);
    expect(params.from.value?.toString()).toBe("1.2.0");

    expect(params.to.value).toBeInstanceOf(SemVer);
    expect(params.to.value?.toString()).toBe("3.0.0");
  });
});
