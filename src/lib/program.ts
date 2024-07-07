import { Argument, Command, Option } from "@commander-js/extra-typings";
import { SUPPORTED_PACKAGE_MANAGERS } from "../constants";
import ora from "ora";
import chalk from "chalk";

export async function makeProgram() {
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
      new Option("-f, --file <branch>", "The filename of the changelog file")
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
      ).choices(["changelog", "releases"] as const)
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

  process.env.DEBUG = program.opts().debug ? "1" : "0";

  const spinner = ora({
    // discardStdin: true,
    text: "Initializing",
  }).start();

  const error = (message: string) => {
    spinner.stop();
    console.log(chalk.red(`${chalk.bold("ERROR")}: ${message}`));
    process.exit(1);
  };

  return {
    instance: program,
    getOptions: () => program.opts(),
    getArguments: () => program.processedArgs,

    spinner,
    setSpinnerText: (text: string) => (spinner.text = text),

    error,
  };
}
