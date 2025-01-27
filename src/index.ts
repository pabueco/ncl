import path from "node:path";
import readline from "node:readline";
import { $ } from "zx";
import semver from "semver";
import { marked, type Token } from "marked";
import { markedTerminal } from "marked-terminal";
import {
  SYMBOLS,
  KEY_SEQUENCES,
  DEFAULT_CHANGELOG_FILENAME,
} from "./constants";
import type { VersionParams, Release, Context } from "./types";
import { debug } from "./utils";
import {
  findChangelogFilesInRepo,
  loadChangelogFile,
  makeChangelogUrl,
  parseReleasesFromChangelog,
} from "./lib/changelog";
import { loadGitHubReleases, renderRelease } from "./lib/releases";
import {
  detectPackageManager,
  getInstalledPackageVersion,
  getPackageRepositoryUrl,
} from "./lib/package";
import { parseVersionParams, versionSatisfiesParams } from "./lib/version";
import { parsePackageArg } from "./lib/input";
import chalk from "chalk";
import { makeProgram } from "./lib/program";
import { isGitHubCliInstalled } from "./lib/cli";

const program = await makeProgram();
const options = program.getOptions();

const basePath = options.project
  ? path.resolve(options.project)
  : process.cwd();

// Set the current working directory for all commands.
$.cwd = basePath;
// Suppresses output for all commands.
$.quiet = true;

console.clear();

program.spinner.text = "Detecting package manager";

const packageManager =
  options.packageManager || (await detectPackageManager(basePath));

const [pkg, versionString] = program.getArguments();

const context: Context = {
  packageManager,
  package: pkg,
  packageArgType: null,
  repoUrl: null,
  repoName: null,
  basePath,
  changelogUrl: null,
  changelogFilePath: options.file?.toLowerCase() || DEFAULT_CHANGELOG_FILENAME,
  branch: options.branch,
};

program.setSpinnerText(`Parsing arguments`);

const parsedPackageArg = await parsePackageArg(pkg, () => {
  if (!context.packageManager) {
    throw program.error(
      "Could not find package manager to retrieve repository URL."
    );
  }

  program.setSpinnerText(`Getting repository info`);

  return getPackageRepositoryUrl(context.package, context.packageManager);
});
context.packageArgType = parsedPackageArg.type;
context.repoUrl = parsedPackageArg.repoUrl;
context.repoName = parsedPackageArg.repoName;

// Parse version range argument.
let versionParams: VersionParams = parseVersionParams(versionString);

// Detect installed package version if not provided.
if (versionParams.type === "range" && !versionParams.from.value) {
  if (!packageManager) {
    throw program.error(
      "Could not find package manager to retrieve installed version."
    );
  }

  program.setSpinnerText(`Detecting installed version`);

  versionParams.from.value = await getInstalledPackageVersion(
    pkg,
    packageManager
  );
  // Exclude the release of the installed version.
  versionParams.from.excluding = true;
}

if (context.packageArgType !== "changelog-url") {
  if (!context.repoUrl) {
    throw program.error(`Could not find repository URL for package '${pkg}'`);
  }

  if (!context.repoName) {
    throw program.error("Could not find repository name");
  }
}

const hasGitHubCli = await isGitHubCliInstalled();

let releases: Release[] = [];

context.changelogUrl =
  context.packageArgType === "changelog-url"
    ? context.package
    : makeChangelogUrl(context);

// Load releases from changelog file.
if (options.source !== "releases") {
  program.setSpinnerText(`Fetching changelog`);

  let urls = new Set([context.changelogUrl]);

  if (
    // URL was constructed automatically and not supplied by the user.
    context.packageArgType !== "changelog-url" &&
    hasGitHubCli
  ) {
    // Try to find all changelog files via the git tree.
    program.setSpinnerText(`Searching for changelog files in repo`);

    try {
      const paths = await findChangelogFilesInRepo(context);
      paths
        .map((path) => makeChangelogUrl(context, path))
        .forEach((path) => urls.add(path));
    } catch (e) {
      debug("Failed to find changelog files in repository");
    }
  }

  program.setSpinnerText(`Loading ${urls.size} changelog files`);

  releases = (
    await Promise.all(
      Array.from(urls).map(async (url) => {
        const content = await loadChangelogFile(url);
        if (!content) return [];

        return await parseReleasesFromChangelog(content, (version) =>
          versionSatisfiesParams(version, versionParams)
        );
      })
    )
  ).flat();

  // Fail if changelog source was forced, but could't be loaded.
  if (!releases.length && options.source === "changelog") {
    throw program.error(
      `Failed to load changelog file or not matching releases found.`
    );
  }
}

// Either the changelog file does not exist it did not contain any releases.
if (!releases.length || options.source === "releases") {
  program.setSpinnerText(`Fetching GitHub releases`);

  if (!hasGitHubCli) {
    throw program.error(
      "GitHub CLI is not installed but required for fetching releases."
    );
  }

  try {
    releases = await loadGitHubReleases(context.repoName!, versionParams);
  } catch (e) {
    throw program.error(
      `Failed to load GitHub releases: ${(e as Error).message}`
    );
  }
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
  throw program.error("No releases found");
}

program.spinner.stop();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

marked.use(
  markedTerminal({
    // reflowText: true,
    // width: 80,
  }) as any
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
  if (mod !== 0 && !options.debug) {
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

  const footer = `[${SYMBOLS.ArrowLeft}|a|k] Previous   [${SYMBOLS.ArrowRight}|d|j] Next   [q|ctrl+c] Quit\n`;

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
