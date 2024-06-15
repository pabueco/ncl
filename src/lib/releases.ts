import { $ } from "bun";
import { GITHUB_PAGE_LIMIT } from "../constants";
import type { RawGitHubRelease, Release, VersionParams } from "../types";
import { debug } from "../utils";
import { findValidVersionInStrings, versionSatisfiesParams } from "./version";
import { format } from "date-fns";
import type { marked as markedType } from "marked";

export async function loadGitHubReleases(
  repoName: string,
  versionParams: VersionParams
): Promise<Release[]> {
  const rawReleases: any[] = [];
  let page = 1;
  let hasFoundStart = false;

  while (page <= GITHUB_PAGE_LIMIT) {
    debug(`Fetching page ${page}...`);

    // const releases =
    //   await $`gh release list --repo ${repoName} --json name,tagName,isLatest --exclude-pre-releases --exclude-drafts --order desc --limit 100`.quiet();
    // We have to use the API because the CLI does not support paging/offsets.
    const releases =
      await $`gh api -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' repos/${repoName}/releases -X GET -f per_page=100 -f page=${page}`.quiet();

    const releasesJson: RawGitHubRelease[] = releases.json();

    if (!releasesJson.length) {
      debug(`No more releases found, stopping.`);
      break;
    }

    if (!hasFoundStart) {
      hasFoundStart = releasesJson.some((r) => {
        const version = findValidVersionInStrings([r.tag_name, r.name]);
        return versionSatisfiesParams(version, versionParams);
      });
    }

    rawReleases.push(...releasesJson);

    // This is not working as expected when the last version is not satisfying the params, but the ones on the previous page are.
    // This can happen with pre-releases for example. Fetching everything is probably the best option.
    // TODO: Find a better way to not have to fetch all releases.
    // const lastRelease = releasesJson[releasesJson.length - 1];
    // const lastVersion = findValidVersionInStrings([
    //   lastRelease.tag_name,
    //   lastRelease.name,
    // ]);
    // if (hasFoundStart && !versionSatisfiesParams(lastVersion, versionParams)) {
    //   debug(`Reached version ${lastVersion}, stopping.`);
    //   break;
    // }

    page++;
  }

  return rawReleases
    .toReversed()
    .map((r) => ({
      version:
        findValidVersionInStrings([r.tag_name, r.name])?.toString() || "",
      content: r.body as string,
      url: r.html_url,
      date: format(new Date(r.published_at), "yyyy-MM-dd"),
    }))
    .filter((r) => {
      return versionSatisfiesParams(r.version, versionParams);
    });
}

export async function renderRelease(
  release: Release,
  marked: typeof markedType
): Promise<string> {
  return typeof release.content === "string"
    ? await marked(release.content)
    : marked.parser(release.content);
}
