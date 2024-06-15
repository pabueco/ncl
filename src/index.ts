import { Argument, Command, Option } from "@commander-js/extra-typings";
import { $ } from "bun";
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
import type { VersionParams, Release, Context } from "./types";
import { debug, error } from "./utils";
import { loadChangelogFile, parseReleasesFromChangelog } from "./lib/changelog";
import { loadGitHubReleases, renderRelease } from "./lib/releases";
import {
  detectPackageManager,
  getInstalledPackageVersion,
  getPackageRepositoryUrl,
} from "./lib/package";
import { parseVersionParams, versionSatisfiesParams } from "./lib/version";
import { parsePackageArg } from "./lib/input";
import chalk from "chalk";

const program = await new Command()
  .description(
    `Interactively view changelogs of packages and GitHub repositories in the terminal.`
  )
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
      "-l, --list",
      "Print all releases in a static list instead of interactive mode"
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
      .choices(["date", "version"] as const)
  )
  .addOption(
    new Option("-d, --order <dir>", "The direction to order releases in")
      .default("asc")
      .choices(["asc", "desc"] as const)
  )
  .addOption(
    new Option(
      "-s, --source <source>",
      "The source to get version changes from"
    )
      .default("changelog")
      .choices(["changelog", "releases"] as const)
  )
  .addOption(new Option("--debug", "Debug mode"))
  .addArgument(
    new Argument(
      "<package/url>",
      "The package name, GitHub URL or changelog URL to inspect"
    )
  )
  .addArgument(new Argument("[<version-range>]", "The version range to load"))
  .parseAsync(process.argv);

const options = program.opts();

const basePath = options.project
  ? path.resolve(options.project)
  : process.cwd();

const packageManager =
  options.packageManager || (await detectPackageManager(basePath));

const [pkg, versionString] = program.processedArgs;

const context: Context = {
  packageManager,
  package: pkg,
  packageArgType: null,
  repoUrl: null,
  repoName: null,
  basePath,
  changelogUrl: null,
};

// Check if package name is a URL to a raw changelog file.
const parsedPackageArg = await parsePackageArg(pkg, () => {
  if (!packageManager) {
    throw error("Could not find package manager to retrieve repository URL.");
  }

  return getPackageRepositoryUrl(
    context.package,
    context.packageManager!,
    context.basePath
  );
});
context.packageArgType = parsedPackageArg.type;
context.repoUrl = parsedPackageArg.repoUrl;
context.repoName = parsedPackageArg.repoName;

// Parse version range argument.
let versionParams: VersionParams = parseVersionParams(versionString);

// Load installed version if not provided.
if (versionParams.type === "range" && !versionParams.from.value) {
  if (!packageManager) {
    throw error(
      "Could not find package manager to retrieve installed version."
    );
  }

  versionParams.from.value = await getInstalledPackageVersion(
    pkg,
    packageManager,
    basePath
  );
  // Exclude the release of the installed version.
  versionParams.from.excluding = true;
}

debug({ context, versionParams });

if (context.packageArgType !== "changelog") {
  if (!context.repoUrl) {
    throw error(`Could not find repository URL for package '${pkg}'`);
  }

  if (!context.repoName) {
    throw error("Could not find repository name");
  }
}

let releases: Release[] = [];

context.changelogUrl =
  context.packageArgType === "changelog"
    ? context.package
    : `https://raw.githubusercontent.com/${context.repoName}/${options.branch}/${options.file}`;

debug(context);

// Load releases from changelog file.
if (options.source === "changelog") {
  debug(`Fetching changelog from: ${context.changelogUrl}`);
  const content = await loadChangelogFile(context.changelogUrl);
  const changelogReleases = await parseReleasesFromChangelog(
    content,
    (version) => versionSatisfiesParams(version, versionParams)
  );

  releases = changelogReleases ?? [];
}

// Either the changelog file does not exist it did not contain any releases.
if (!releases.length || options.source === "releases") {
  debug(`Trying GitHub releases...`);

  const isGithubCliInstalled = await $`gh --version`.quiet();
  if (isGithubCliInstalled.exitCode !== 0) {
    throw error("GitHub CLI is not installed");
  }

  releases = await loadGitHubReleases(context.repoName!, versionParams);
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
  throw error("No releases found");
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

  const pager = `[${currentReleaseIndex + 1}/${releases.length}]`;

  const header = `${pager} ${chalk.magenta(
    currentRelease.version
  )}${datePart} | ${versionRangePart}`;

  const footer = `[${SYMBOLS.ArrowLeft}|a|k] Previous   [${SYMBOLS.ArrowRight}|d|j] Next   [q|Ctrl+C] Quit\n`;

  console.log(header + "\n");

  const string = await renderRelease(currentRelease, marked);

  console.log(string.trim());

  console.log("\n" + chalk.dim(footer));
}

process.stdin.on("keypress", async (str, key) => {
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

// Initial render.
navigateAndRender(0);
