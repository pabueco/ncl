import semver, { SemVer } from "semver";
import type { VersionParams } from "../types";

export function maybeSemverRange(version: string): boolean {
  // Anything other than numbers, dots, letters, and hyphens is considered a range.
  const regex = new RegExp(/[^0-9a-zA-Z.-]/);
  return regex.test(version) || version.endsWith(".x");
}

export function coerceToSemVer(version: string | null): SemVer | null {
  if (!version) {
    return null;
  }

  return semver.coerce(version, {
    includePrerelease: true,
  });
}

export function findValidVersionInStrings(strings: string[]): SemVer | null {
  for (const string of strings) {
    const version = coerceToSemVer(string);

    if (version) {
      return version;
    }
  }

  return null;
}

export function versionSatisfiesParams(
  version: SemVer | string | null,
  params: VersionParams
): boolean {
  if (!version) {
    return false;
  }

  if (params.type === "ref") {
    return semver.satisfies(version, params.ref, {
      includePrerelease: true,
    });
  }

  const satisfiesFrom =
    !params.from.value ||
    (params.from.range
      ? semver.satisfies(version, params.from.range, {
          includePrerelease: true,
        }) || semver.outside(version, params.from.range, ">")
      : params.from.excluding
      ? semver.gt(version, params.from.value)
      : semver.gte(version, params.from.value));

  const satisfiesTo =
    !params.to.value ||
    (params.to.range
      ? semver.satisfies(version, params.to.range, {
          includePrerelease: true,
        }) || semver.outside(version, params.to.range, "<")
      : params.to.excluding
      ? semver.lt(version, params.to.value)
      : semver.lte(version, params.to.value));

  return satisfiesFrom && satisfiesTo;
}

export function parseVersionParams(versionString?: string): VersionParams {
  if (!versionString) {
    return {
      from: {
        value: null,
      },
      to: {
        value: null,
      },
      type: "range",
    };
  }

  const rangeSeperatorRegex = new RegExp(/\.{2,4}/);

  // Range
  if (rangeSeperatorRegex.test(versionString)) {
    const [from, to, ...rest] = versionString.split(rangeSeperatorRegex);

    if (rest.length) {
      throw new Error(`Invalid version range: ${versionString}`);
    }

    const fromCoerced = coerceToSemVer(from);
    if (from && !fromCoerced) {
      throw new Error(
        `Invalid version range: ${versionString}. From is invalid.`
      );
    }

    const toCoerced = coerceToSemVer(to);
    if (to && !toCoerced) {
      throw new Error(
        `Invalid version range: ${versionString}. To is invalid.`
      );
    }

    const params: VersionParams = {
      from: {
        value: coerceToSemVer(from),
        raw: from,
        range: maybeSemverRange(from) ? semver.validRange(from) : null,
      },
      to: {
        value: coerceToSemVer(to),
        raw: to,
        range: maybeSemverRange(to) ? semver.validRange(to) : null,
      },
      type: "range",
    };

    // Check that the range are not mutually exclusive.
    // if (
    //   params.from.range &&
    //   params.to.range &&
    //   !semver.intersects(params.from.range, params.to.range)
    // ) {
    //   throw new Error(
    //     `Invalid version range: ${versionString}. The from and to ranges are mutually exclusive.`
    //   );
    // }

    if (!params.from.value && !params.to.value) {
      throw new Error(
        `Invalid version range: ${versionString}. Both from and to are invalid.`
      );
    }

    return params;
  }
  // Single reference, like: 1.x, 1.2, 1.2.x
  else {
    if (!semver.validRange(versionString)) {
      throw new Error(`Invalid version range: ${versionString}`);
    }

    return {
      ref: versionString,
      type: "ref",
    };
  }
}
