import { Argument, Command, Option } from "@commander-js/extra-typings";
import { $, type Subprocess } from "bun";
import path from "node:path";
import semver from "semver";
import { marked, type Token } from "marked";
// @ts-expect-error missing types
import { markedTerminal } from "marked-terminal";
import readline from "readline";
import { format } from "date-fns";
// import { select } from "@clack/prompts";

const SUPPORTED_PACKAGE_MANAGERS = [
  "npm",
  "yarn",
  "pnpm",
  "bun",
  "composer",
] as const;

type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

type BaseRelease = {
  version: string;
  content: string | Token[];
  url?: string;
  date?: string;
};

type ReleaseWithTokens = BaseRelease & {
  content: Token[];
};

type ReleaseWithString = BaseRelease & {
  content: string;
};

type Release = ReleaseWithTokens | ReleaseWithString;

const SYMBOLS = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "↵",
};

async function detectPackageManager(
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

  return null;
}

const program = await new Command()
  .addOption(
    new Option(
      "-p, --project <project>",
      "Path to the directory to run in. Defaults to the current directory."
    )
  )
  .addOption(
    new Option(
      "-pm, --package-manager <package-manager>",
      "The package manager to use for detecting the installed version and other info"
    ).choices(SUPPORTED_PACKAGE_MANAGERS)
  )
  .addOption(
    new Option(
      "-l, --list",
      "Render all releases in a list instead of interactive mode"
    )
  )
  .addOption(
    new Option(
      "-from, --from-version <from-version>",
      "Include releases starting from this version. Defaults to the installed version of the package."
    )
  )
  .addOption(
    new Option(
      "-to, --to-version <to-version>",
      "Include releases up to this version."
    ).default("latest")
  )
  .addOption(
    new Option(
      "-b, --branch <branch>",
      "The branch to look for and load the changelog file from"
    ).default("main")
  )
  .addOption(
    new Option(
      "-f, --file <branch>",
      "The filename of the changelog file"
    ).default("CHANGELOG.md")
  )
  .addArgument(new Argument("<package>", "The package to inspect"))
  // .action(async (p) => {
  //   console.log(`Inspecting package: ${p}`);
  // })
  .parseAsync(process.argv);

const options = program.opts();

const basePath = options.project
  ? path.resolve(options.project)
  : process.cwd();

console.log(`Using base path: ${basePath}`);

const packageManager =
  options.packageManager || (await detectPackageManager(basePath));
if (!packageManager) {
  throw new Error("Could not detect package manager");
}

const pkg = program.args[0];

console.log(`Using package manager: ${packageManager} for package ${pkg}`);

let fromVersion = options.fromVersion
  ? semver.coerce(options.fromVersion)
  : await getInstalledPackageVersion(pkg, packageManager);

let toVersion = options.toVersion ? semver.coerce(options.toVersion) : null;

console.log({
  fromVersion: fromVersion?.toString(),
  toVersion: toVersion?.toString(),
});

let repoUrl = await getPackageRepositoryUrl(pkg, packageManager);
if (repoUrl && !repoUrl.includes("github.com")) {
  throw new Error(
    `Unsupported repository URL: ${repoUrl}. Only GitHub is currently supported.`
  );
}

if (!repoUrl) {
  console.log(`Could not detect repository URL, trying package name.`);

  const maybeUrl = `https://github.com/${pkg}`;
  const res = await fetch(maybeUrl);

  if (res.ok) {
    repoUrl = maybeUrl;
  } else {
    throw new Error(`Could not detect repository URL for package ${pkg}`);
  }
}

console.log({ repoUrl });

const isGithubCliInstalled = await $`gh --version`.quiet();
if (isGithubCliInstalled.exitCode !== 0) {
  throw new Error("GitHub CLI is not installed");
}

const repoName = repoUrl.match(/github.com\/(.*)$/)?.[1];
console.log({ repoName });

const branch = options.branch;
const file = options.file;
const changelogUrl = `https://raw.githubusercontent.com/${repoName}/${branch}/${file}`;

console.log(`Fetching changelog from: ${changelogUrl}`);

const res = await fetch(changelogUrl);

let releases: Release[] = [];

if (res.ok) {
  const changelogSource = await res.text();
  releases = await parseReleasesFromChangelog(changelogSource);
}

// Either the changelog file does not exist it did not contain any releases.
if (!releases.length) {
  console.warn(
    `Could not fetch changelog from ${changelogUrl}. Trying GitHub releases...`
  );
  releases = await loadGitHubReleases();
}

await start(releases);

async function parseReleasesFromChangelog(source: string): Promise<Release[]> {
  const tokens = marked.lexer(source);

  const releases: ReleaseWithTokens[] = [];

  let currentRelease: ReleaseWithTokens | null = null;
  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 2) {
      const text = token.text.trim();
      const version = semver.coerce(text);

      // If we can't find a version, treat it like any other token.
      if (!version) {
        currentRelease?.content.push(token);
        continue;
      }

      if (currentRelease) {
        releases.unshift(currentRelease);
      }

      if (fromVersion && !semver.gte(version, fromVersion)) {
        currentRelease = null;
        continue;
      }

      if (toVersion && !semver.lte(version, toVersion)) {
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

async function loadGitHubReleases(): Promise<Release[]> {
  const rawReleases: any[] = [];
  let page = 1;

  while (true) {
    console.log(`Fetching page ${page}...`);

    // const releases =
    //   await $`gh release list --repo ${repoName} --json name,tagName,isLatest --exclude-pre-releases --exclude-drafts --order desc --limit 100`.quiet();
    // We have to use the API because the CLI does not support paging/offsets.
    const releases =
      await $`gh api -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' repos/${repoName}/releases -X GET -f per_page=100 -f page=${page}`.quiet();

    if (releases.exitCode !== 0) {
      throw new Error("Could not fetch releases" + releases.stderr.toString());
    }

    const releasesJson = releases.json();

    if (!releasesJson.length) {
      console.log(`No more releases found, stopping.`);
      break;
    }

    rawReleases.push(...releasesJson);

    const lastVersion = semver.coerce(
      releasesJson[releasesJson.length - 1].tag_name
    );

    if (fromVersion && lastVersion && semver.lt(lastVersion, fromVersion)) {
      console.log(`Reached version ${lastVersion}, stopping.`);
      break;
    }

    page++;
  }

  return rawReleases
    .toReversed()
    .map((r) => ({
      version: (
        semver.coerce(r.tag_name) ?? semver.coerce(r.name)
      )?.toString()!,
      content: r.body as string,
      url: r.html_url,
      date: format(new Date(r.published_at), "yyyy-MM-dd"),
    }))
    .filter((r) => {
      return (
        r.version &&
        (!fromVersion || semver.gte(r.version, fromVersion)) &&
        (!toVersion || semver.lte(r.version, toVersion))
      );
    });
}

async function getInstalledPackageVersion(
  pkg: string,
  manager: PackageManager
): Promise<string | null> {
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
        const match = list.match(new RegExp(`${pkg}@(.*)`));
        return match?.[1] || null;
      }
      case "composer": {
        const info = await $`composer show ${pkg} --no-ansi`
          .cwd(basePath)
          .text();
        const match = info.match(/versions[ \t]+: \* (.*)/);
        return match?.[1] || null;
      }
    }
  })();

  // if (!version) {
  //   throw new Error("Could not detect installed version");
  // }

  return version;
}

async function getPackageRepositoryUrl(
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
    }
  } catch (e) {
    // console.error(e);
    // We want to support getting changelogs without being in an actual project.
  }

  if (!url) return null;

  // Remove git+ and .git from the URL
  return url
    .trim()
    .replace(/git\+/, "")
    .replace(/\.git$/, "");
}

async function start(releases: Release[]) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  marked.use(
    markedTerminal({
      // reflowText: true,
      // width: 80,
    })
  );

  if (options.list) {
    const isTokens = typeof releases[0].content !== "string";

    const string = isTokens
      ? marked.parser(releases.flatMap((r) => r.content as Token[]))
      : await marked(
          releases
            .map((r) => {
              let title = r.version;

              if (r.date) {
                title += ` (${r.date})`;
              }

              if (r.url) {
                title = `[${title}](${r.url})`;
              }

              return [`# ${title}`, r.content].join("\n");
            })
            .join("\n\n")
        );

    console.log(string);

    process.exit();
  }

  let currentReleaseIndex = 0;

  const navigateAndRender = async (mod = +1) => {
    console.clear();

    currentReleaseIndex =
      (currentReleaseIndex + mod + releases.length) % releases.length;

    const currentRelease = releases[currentReleaseIndex];

    const datePart = currentRelease.date ? ` (${currentRelease.date})` : "";

    console.log(
      `[${currentReleaseIndex + 1}/${releases.length}] Version: ${
        currentRelease.version
      }${datePart}   [${SYMBOLS.ArrowLeft}|a|k] Previous   [${
        SYMBOLS.ArrowRight
      }|d|j] Next   [q|Ctrl+C] Quit\n`
    );

    const string =
      typeof currentRelease.content === "string"
        ? await marked(currentRelease.content)
        : // currentRelease.content
          marked.parser(currentRelease.content);

    console.log(string);
  };

  process.stdin.on("keypress", async (str, key) => {
    // '\u0003' is Ctrl+C
    if (key.name === "q" || key.sequence === "\u0003") {
      rl.close();
      process.exit();
    }

    switch (key.name) {
      case "right":
      case "space":
      // case "down":
      case "return":
      case "tab":
      case "j":
      case "d":
        navigateAndRender(+1);
        break;
      case "left":
      // case "up":
      case "k":
      case "a":
        navigateAndRender(-1);
        break;
      // case "escape":
      // scene = "select";
      // console.clear();
      // const projectType = await select({
      //   message: "Pick a project type.",
      //   options: [
      //     { value: "ts", label: "TypeScript" },
      //     { value: "js", label: "JavaScript" },
      //     { value: "js", label: "JavaScript" },
      //     { value: "js", label: "JavaScript" },
      //     { value: "js", label: "JavaScript" },
      //     { value: "coffee", label: "CoffeeScript", hint: "oh no" },
      //   ],
      // });
      // scene = "view";
      // navigateAndRender(0);
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();

  navigateAndRender(0);
}
