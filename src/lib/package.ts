import { $ } from "bun";
import type { PackageManager } from "../types";
import { coerceToSemVer } from "./version";
import type { SemVer } from "semver";
import { debug } from "../utils";

export async function detectPackageManager(
  basePath: string
): Promise<PackageManager | null> {
  if (await Bun.file(`${basePath}/yarn.lock`).exists()) {
    return "yarn";
  }

  if (await Bun.file(`${basePath}/package-lock.json`).exists()) {
    return "npm";
  }

  if (await Bun.file(`${basePath}/pnpm-lock.yaml`).exists()) {
    return "pnpm";
  }

  if (await Bun.file(`${basePath}/bun.lockb`).exists()) {
    return "bun";
  }

  if (await Bun.file(`${basePath}/composer.json`).exists()) {
    return "composer";
  }

  if (await Bun.file(`${basePath}/Cargo.toml`).exists()) {
    return "cargo";
  }

  return null;
}

export async function getInstalledPackageVersion(
  pkg: string,
  manager: PackageManager,
  basePath: string
): Promise<SemVer | null> {
  const version = await (async () => {
    switch (manager) {
      case "npm":
        return await $`npm info ${pkg} version`.cwd(basePath).text();
      case "yarn":
        return await $`yarn info ${pkg} version`.cwd(basePath).text();
      case "pnpm":
        return await $`pnpm info ${pkg} version`.cwd(basePath).text();
      case "bun": {
        const list = await $`bun pm ls`.cwd(basePath).text();
        // Must start with a space to avoid matching another package which ends with the same name.
        const match = list.match(new RegExp(` ${pkg}@(.*)`));
        return match?.[1] || null;
      }
      case "composer": {
        const info = await $`composer show ${pkg} --no-ansi`
          .cwd(basePath)
          .text();
        const match = info.match(/versions[ \t]+: \* (.*)/);
        return match?.[1] || null;
      }
      case "cargo": {
        const info = await $`cargo metadata`.cwd(basePath).json();
        const dep = info.packages.find((p: any) => p.name === pkg);
        return dep?.version || null;
      }
    }
  })();

  return coerceToSemVer(version);
}

export async function getPackageRepositoryUrl(
  pkg: string,
  manager: PackageManager,
  basePath: string
): Promise<string | null> {
  let url = "";

  try {
    switch (manager) {
      case "npm":
      case "yarn":
      case "pnpm":
      case "bun":
        url = await $`npm view ${pkg} repository.url`.cwd(basePath).text();
        break;
      case "composer": {
        const info = await $`composer show ${pkg} --no-ansi`
          .cwd(basePath)
          .text();
        const match = info.match(/source[ \t]+: \[git\] (.*) .*/);
        url = match?.[1] || "";
        break;
      }
      case "cargo": {
        const info = await $`cargo metadata`.cwd(basePath).json();
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
