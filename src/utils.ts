import { inspect } from "bun";
import chalk from "chalk";

export function debug(...args: any[]) {
  if (process.env.DEBUG) {
    args.map(logInspect);
  }
}

export function error(message: string, data?: Record<string, unknown>) {
  console.log(chalk.red(`${chalk.bold("ERROR")}: ${message}`));
  if (data) {
    logInspect(data);
  }
  process.exit(1);
}

function logInspect(x: any) {
  console.log(inspect(x, { depth: Infinity }));
}
