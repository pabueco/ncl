import { $ } from "zx";

export async function isGitHubCliInstalled() {
  const command = await $`gh --version`.quiet();
  return command.exitCode === 0;
}
