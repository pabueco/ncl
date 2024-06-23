import { marked } from "marked";
import type { Context, Release, ReleaseWithTokens } from "../types";
import { coerceToSemVer } from "./version";
import type { SemVer } from "semver";
import { $ } from "zx";
import { orderBy } from "lodash-es";

// Ends with "changelog" or "changelog.md" or "changelog-<anything>.md" (like "changelog-1.0.md")
const CHANGELOG_REGEX = /changelog(-.*)?(\.md)?$/i;

export async function loadChangelogFile(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }

  return await res.text();
}

export async function parseReleasesFromChangelog(
  source: string,
  versionSatisfiesParams: (version: SemVer | string) => boolean
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

      if (!versionSatisfiesParams(version)) {
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

  return CHANGELOG_REGEX.test(url);
}

export function makeChangelogUrl(context: Context, filePath?: string) {
  return `https://raw.githubusercontent.com/${context.repoName}/${
    context.branch
  }/${filePath || context.changelogFilePath}`;
}

/**
 * Find the paths of all changelog files in a GitHub repo.
 * Returns them in order: latest -> oldest.
 */
export async function findChangelogFilesInRepo(
  context: Context
): Promise<string[]> {
  const fileTree =
    await $`gh api -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' repos/${context.repoName}/git/trees/${context.branch}?recursive=1`;

  const files = JSON.parse(fileTree.stdout).tree;

  const paths: string[] = files
    .filter((f: any) => CHANGELOG_REGEX.test(f.path))
    .map((f: any) => f.path);

  // Sort by path length. Longer paths indicate older changelogs, so they should come later.
  // E.g. https://github.com/vuejs/core/tree/main/changelogs
  return orderBy(
    paths,
    [(path) => path.length, (path) => path],
    ["asc", "desc"]
  );
}
