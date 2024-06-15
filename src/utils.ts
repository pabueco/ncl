import { inspect } from "bun";

export function debug(...args: any[]) {
  if (process.env.DEBUG) {
    args.map(logInspect);
  }
}

function logInspect(x: any) {
  console.log(inspect(x, { depth: Infinity }));
}
