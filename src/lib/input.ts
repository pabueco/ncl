import { isChangelogUrl } from "./changelog";
const GITHUB_URL_PREFIX = "https://github.com/";

type ParsedArg = {
  type: "package-name" | "repo-name" | "repo-url" | "changelog-url" | null;
  repoUrl: string | null;
  repoName: string | null;
};

export async function parsePackageArg(
  arg: string,
  getPackageRepoUrl: () => Promise<string | null>
): Promise<ParsedArg> {
  if (isChangelogUrl(arg)) {
    return { type: "changelog-url", repoUrl: null, repoName: null };
  }

  if (isRepoUrl(arg)) {
    return {
      type: "repo-url",
      repoUrl: arg,
      repoName: getRepoNameFromUrl(arg),
    };
  }

  if (isRepoName(arg)) {
    return {
      type: "repo-name",
      repoUrl: `${GITHUB_URL_PREFIX}${arg}`,
      repoName: arg,
    };
  }

  const repoUrl = await getPackageRepoUrl();

  return {
    type: "package-name",
    repoUrl,
    repoName: repoUrl ? getRepoNameFromUrl(repoUrl) : null,
  };
}

export function isRepoUrl(string: string): boolean {
  return string.startsWith(GITHUB_URL_PREFIX);
}

export function getRepoNameFromUrl(url: string): string {
  return url.slice(GITHUB_URL_PREFIX.length).split("/").slice(0, 2).join("/");
}

// Two alphanumeric strings separated by a slash
export function isRepoName(string: string): boolean {
  return /^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(string);
}
