import { $, globby } from "zx";
import type { PackageManager } from "../types";
import { coerceToSemVer } from "./version";
import type { SemVer } from "semver";
import { debug } from "../utils";

export async function detectPackageManager(
  basePath: string
): Promise<PackageManager | null> {
  const managerByFile: Record<string, PackageManager> = {
    "yarn.lock": "yarn",
    "package-lock.json": "npm",
    "pnpm-lock.yaml": "pnpm",
    "bun.lockb": "bun",
    "composer.json": "composer",
    "Cargo.toml": "cargo",
  };

  const files = await globby("*", { cwd: basePath, onlyFiles: true });

  for (const file of files) {
    if (managerByFile[file]) {
      return managerByFile[file];
    }
  }

  return null;
}

export async function getInstalledPackageVersion(
  pkg: string,
  manager: PackageManager
): Promise<SemVer | null> {
  const version = await (async () => {
    switch (manager) {
      case "npm":
      case "yarn":
      case "pnpm":
        return await $`${manager} info ${pkg} version`.text();
      case "bun": {
        const list = await $`bun pm ls`.text();
        // Must start with a space to avoid matching another package which ends with the same name.
        const match = list.match(new RegExp(` ${pkg}@(.*)`));
        return match?.[1] || null;
      }
      case "composer": {
        const info = await $`composer show ${pkg} --no-ansi`.text();
        const match = info.match(/versions[ \t]+: \* (.*)/);
        return match?.[1] || null;
      }
      case "cargo": {
        const info = await $`cargo metadata`.json();
        const dep = info.packages.find((p: any) => p.name === pkg);
        return dep?.version || null;
      }
    }
  })();

  return coerceToSemVer(version);
}

export async function getPackageRepositoryUrl(
  pkg: string,
  manager: PackageManager
): Promise<string | null> {
  let url = "";

  try {
    switch (manager) {
      case "npm":
      case "yarn":
      case "pnpm":
      case "bun":
        url = await $`npm view ${pkg} repository.url`.text();
        break;
      case "composer": {
        const info = await $`composer show ${pkg} --no-ansi`.text();
        const match = info.match(/source[ \t]+: \[git\] (.*) .*/);
        url = match?.[1] || "";
        break;
      }
      case "cargo": {
        const info = await $`cargo metadata`.json();
        const dep = info.packages.find((p: any) => p.name === pkg);
        return dep?.repository || null;
      }
    }
  } catch (e) {
    // console.error(e);
    // We want to support getting changelogs without being in an actual project.
  }

  // Remove git+ and .git from the URL
  url = url
    .trim()
    .replace(/git\+/, "")
    .replace(/\.git$/, "");

  if (url) return url;

  debug(`Could not detect repository URL, trying package name.`);

  const maybeUrl = `https://github.com/${pkg}`;
  const res = await fetch(maybeUrl);

  return res.ok ? maybeUrl : null;
}
