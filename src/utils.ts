import { inspect } from "bun";

export function debug(...args: any[]) {
  if (process.env.DEBUG) {
    console.log(...args.map((x) => inspect(x, { depth: Infinity })));
  }
}
