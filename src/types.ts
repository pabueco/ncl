import type { Token } from "marked";
import type { SUPPORTED_PACKAGE_MANAGERS } from "./constants";
import type { SemVer } from "semver";

export type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

export type BaseRelease = {
  version: string;
  content: string | Token[];
  url?: string;
  date?: string;
};

export type ReleaseWithTokens = BaseRelease & {
  content: Token[];
};

export type ReleaseWithString = BaseRelease & {
  content: string;
};

export type Release = ReleaseWithTokens | ReleaseWithString;

export type VersionParams =
  | {
      // `null` indicates the installed version should be used.
      from: {
        value: SemVer | null;
        excluding?: boolean;
        raw?: string;
        range?: string | null;
      };
      // `null` indicates the latest version should be used.
      to: {
        value: SemVer | null;
        excluding?: boolean;
        raw?: string;
        range?: string | null;
      };
      type: "range";
    }
  | {
      ref: string;
      type: "ref";
    };

export type RawGitHubRelease = {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
};

export type Context = {
  package: string;
  packageArgType:
    | "package-name"
    | "repo-name"
    | "repo-url"
    | "changelog-url"
    | null;
  repoUrl: string | null;
  repoName: string | null;
  basePath: string;
  packageManager: PackageManager | null;
  changelogUrl: string | null;
  changelogFilePath: string;
  branch: string;
};
