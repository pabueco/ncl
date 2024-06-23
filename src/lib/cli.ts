import { $ } from "zx";

export async function isGitHubCliInstalled() {
  const command = await $`gh --version`.nothrow();
  return command.exitCode === 0;
}
