import { marked } from "marked";
import type { Context, Release, ReleaseWithTokens } from "../types";
import { coerceToSemVer } from "./version";
import type { SemVer } from "semver";
import { $ } from "zx";

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

  // Ends with "changelog" or "changelog.md" or "changelog-<anything>.md" (like "changelog-1.0.md")
  const regex = /changelog(-.*)?(\.md)?$/i;
  return regex.test(url);
}

export function makeChangelogUrl(context: Context) {
  return `https://raw.githubusercontent.com/${context.repoName}/${context.branch}/${context.changelogFilePath}`;
}

/**
 * Find the path of a changelog file in a GitHub repo.
 */
export async function findChangelogFilePathInRepo(
  context: Context
): Promise<string | null> {
  const fileTree =
    await $`gh api -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' repos/${context.repoName}/git/trees/${context.branch}?recursive=1`;

  const files = JSON.parse(fileTree.stdout).tree;

  const changelogItem = files.find((f: any) =>
    f.path.toLowerCase().includes(`/${context.changelogFilePath}`)
  );

  if (!changelogItem) return null;

  return changelogItem.path;
}
