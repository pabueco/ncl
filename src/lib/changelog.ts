import { marked } from "marked";
import type { Release, ReleaseWithTokens, VersionParams } from "../types";
import { coerceToSemVer, versionSatisfiesParams } from "./version";

export async function loadChangelogFile(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    return "";
  }

  return await res.text();
}

export async function parseReleasesFromChangelog(
  source: string,
  versionParams: VersionParams
): Promise<Release[]> {
  if (!source) {
    return [];
  }

  const tokens = marked.lexer(source);

  const releases: ReleaseWithTokens[] = [];

  let currentRelease: ReleaseWithTokens | null = null;
  for (const token of tokens) {
    if (token.type === "heading" && [1, 2, 3].includes(token.depth)) {
      const text = token.text.trim();
      const version = coerceToSemVer(text);

      // If we can't find a version, treat it like any other token.
      if (!version) {
        currentRelease?.content.push(token);
        continue;
      }

      if (currentRelease) {
        releases.unshift(currentRelease);
      }

      if (!versionSatisfiesParams(version, versionParams)) {
        currentRelease = null;
        continue;
      }

      currentRelease = {
        version: version.toString(),
        content: [],
      };
    }

    currentRelease?.content.push(token);
  }

  if (currentRelease && currentRelease.content.length > 0) {
    releases.unshift(currentRelease);
  }

  return releases;
}

export function isChangelogUrl(url: string) {
  try {
    new URL(url);
  } catch {
    return false;
  }

  // Ends with "changelog" or "changelog.md" or "changelog-<anything>.md" (like "changelog-1.0.md")
  const regex = /changelog(-.*)?(\.md)?$/i;
  return regex.test(url);
}
