import type { Context } from "../types";
import { isChangelogUrl } from "./changelog";
import { getPackageRepositoryUrl } from "./package";
const GITHUB_URL_PREFIX = "https://github.com/";

type ParsedArg = {
  type: "package-name" | "repo-name" | "repo-url" | "changelog" | null;
  repoUrl: string | null;
  repoName: string | null;
};

export async function parsePackageArg(
  arg: string,
  context: Context
): Promise<ParsedArg> {
  if (isChangelogUrl(arg)) {
    return { type: "changelog", repoUrl: null, repoName: null };
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

  const repoUrl = await getPackageRepositoryUrl(
    context.package,
    context.packageManager,
    context.basePath
  );

  const repoName = repoUrl ? getRepoNameFromUrl(repoUrl) : null;

  return {
    type: "package-name",
    repoUrl,
    repoName,
  };
}

function isRepoUrl(string: string): boolean {
  return string.startsWith(GITHUB_URL_PREFIX);
}

function getRepoNameFromUrl(url: string): string {
  return url.slice(GITHUB_URL_PREFIX.length).split("/").slice(0, 2).join("/");
}

// Two alphanumeric strings separated by a slash
function isRepoName(string: string): boolean {
  return /^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(string);
}
