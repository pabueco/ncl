import { Argument, Command, Option } from "@commander-js/extra-typings";
import { $, inspect } from "bun";
import path from "node:path";
import semver from "semver";
import { marked, type Token } from "marked";
// @ts-expect-error missing types
import { markedTerminal } from "marked-terminal";
import readline from "readline";
import {
  SUPPORTED_PACKAGE_MANAGERS,
  SYMBOLS,
  KEY_SEQUENCES,
} from "./constants";
import type { VersionParams, Release } from "./types";
import { debug } from "./utils";
import { loadChangelogFile, parseReleasesFromChangelog } from "./lib/changelog";
import { loadGitHubReleases } from "./lib/releases";
import {
  detectPackageManager,
  getInstalledPackageVersion,
  getPackageRepositoryUrl,
} from "./lib/package";
import { parseVersionParams } from "./lib/version";

const program = await new Command()
  .addOption(
    new Option(
      "-p, --project <project>",
      "Path to the directory to run in. Defaults to the current directory."
    )
  )
  .addOption(
    new Option(
      "-m, --package-manager <package-manager>",
      "The package manager to use for detecting the installed version and other info"
    ).choices(SUPPORTED_PACKAGE_MANAGERS)
  )
  .addOption(
    new Option(
      "-s, --static",
      "Print all releases in a static list instead of interactive mode"
    )
  )
  .addOption(
    new Option(
      "-r, --force-releases",
      "Force the use of GitHub releases instead of parsing the changelog file"
    )
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
  .addOption(
    new Option("-o, --order-by <field>", "The field to order releases by")
      .default("date")
      .choices(["date", "version"])
  )
  .addOption(
    new Option("-d, --order <dir>", "The direction to order releases in")
      .default("asc")
      .choices(["asc", "desc"])
  )
  .addOption(new Option("--debug", "Debug mode"))
  .addArgument(new Argument("<package>", "The package to inspect"))
  .addArgument(new Argument("[<version-range>]", "The version range to load"))
  .parseAsync(process.argv);

const options = program.opts();

const basePath = options.project
  ? path.resolve(options.project)
  : process.cwd();

debug({ basePath });

const packageManager =
  options.packageManager || (await detectPackageManager(basePath));
if (!packageManager) {
  throw new Error("Could not detect package manager");
}

const [pkg, versionString] = program.processedArgs;

debug(`Using package manager: ${packageManager} for package ${pkg}`);

// Parse version range argument.
let versionParams: VersionParams = parseVersionParams(versionString);

// Load installed version if not provided.
if (versionParams.type === "range" && !versionParams.from.value) {
  versionParams.from.value = await getInstalledPackageVersion(
    pkg,
    packageManager,
    basePath
  );
  // Exclude the release of the installed version.
  versionParams.from.excluding = true;
}

debug(inspect({ versionParams }, { depth: Infinity }));

let repoUrl = await getPackageRepositoryUrl(pkg, packageManager, basePath);
if (repoUrl && !repoUrl.includes("github.com")) {
  throw new Error(
    `Unsupported repository URL: ${repoUrl}. Only GitHub is currently supported.`
  );
}

if (!repoUrl) {
  debug(`Could not detect repository URL, trying package name.`);

  const maybeUrl = `https://github.com/${pkg}`;
  const res = await fetch(maybeUrl);

  if (res.ok) {
    repoUrl = maybeUrl;
  } else {
    throw new Error(`Could not detect repository URL for package ${pkg}`);
  }
}

debug({ repoUrl });

const isGithubCliInstalled = await $`gh --version`.quiet();
if (isGithubCliInstalled.exitCode !== 0) {
  throw new Error("GitHub CLI is not installed");
}

const repoName = repoUrl.match(/github.com\/(.*)$/)?.[1];
debug({ repoName });

if (!repoName) {
  throw new Error("Could not find repository name");
}

let releases: Release[] = [];

const changelogUrl = `https://raw.githubusercontent.com/${repoName}/${options.branch}/${options.file}`;

// Load releases from changelog file.
if (!options.forceReleases) {
  debug(`Fetching changelog from: ${changelogUrl}`);
  const content = await loadChangelogFile(changelogUrl);
  const changelogReleases = await parseReleasesFromChangelog(
    content,
    versionParams
  );

  if (changelogReleases) {
    releases = changelogReleases;
  }
}

// Either the changelog file does not exist it did not contain any releases.
if (!releases.length) {
  console.warn(`Trying GitHub releases...`);
  releases = await loadGitHubReleases(repoName, versionParams);
  debug(`Found ${releases.length} releases.`);
}

// Default is by date (= order the releases appear in), so we only need to sort by version.
if (options.orderBy === "version") {
  releases = releases.toSorted((a, b) => {
    return semver.compare(a.version, b.version);
  });
}

// Default is ascending, so we only need to reverse if descending.
if (options.order === "desc") {
  releases = releases.toReversed();
}

if (!releases.length) {
  throw new Error("No releases found");
}

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

if (options.static) {
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

async function navigateAndRender(mod = +1) {
  // Prevent clear on first render in debug mode.
  if (mod !== 0 || !options.debug) {
    console.clear();
  }

  currentReleaseIndex =
    (currentReleaseIndex + mod + releases.length) % releases.length;

  const currentRelease = releases[currentReleaseIndex];

  const datePart = currentRelease.date ? ` (${currentRelease.date})` : "";

  const versionRangePart = `${releases[0].version} - ${
    releases[releases.length - 1].version
  }`;

  console.log(
    `${versionRangePart} | [${currentReleaseIndex + 1}/${
      releases.length
    }] Version: ${currentRelease.version}${datePart}   [${
      SYMBOLS.ArrowLeft
    }|a|k] Previous   [${SYMBOLS.ArrowRight}|d|j] Next   [q|Ctrl+C] Quit\n`
  );

  const string =
    typeof currentRelease.content === "string"
      ? await marked(currentRelease.content)
      : marked.parser(currentRelease.content);

  console.log(string);
}

process.stdin.on("keypress", async (str, key) => {
  // '\u0003' is Ctrl+C
  if (key.name === "q" || key.sequence === KEY_SEQUENCES.CtrlC) {
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
  }
});

process.stdin.setRawMode(true);
process.stdin.resume();

navigateAndRender(0);
