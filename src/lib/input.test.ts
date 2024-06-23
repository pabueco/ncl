import { describe, it, expect, mock } from "bun:test";
import {
  getRepoNameFromUrl,
  isRepoName,
  isRepoUrl,
  parsePackageArg,
} from "./input";

describe("isRepoUrl", () => {
  it("returns true for GitHub URL", () => {
    expect(isRepoUrl("https://github.com/owner/repo")).toBe(true);
  });

  it("returns false for non-GitHub URL", () => {
    expect(isRepoUrl("https://example.com/owner/repo")).toBe(false);
    expect(isRepoUrl("https://example.com")).toBe(false);
  });
});

describe("getRepoNameFromUrl", () => {
  it("returns owner/repo from GitHub URL", () => {
    expect(getRepoNameFromUrl("https://github.com/owner/repo")).toBe(
      "owner/repo"
    );
    expect(
      getRepoNameFromUrl("https://github.com/owner/repo/some/more/stuff")
    ).toBe("owner/repo");
  });
});

describe("isRepoName", () => {
  it("returns true for owner/repo", () => {
    expect(isRepoName("owner/repo")).toBe(true);
  });

  it("returns false for invalid repo name", () => {
    expect(isRepoName("hello world")).toBe(false);
    expect(isRepoName("owner")).toBe(false);
    expect(isRepoName("owner/repo/extra")).toBe(false);
  });
});

describe("parsePackageArg", () => {
  it("detects changelog URL", async () => {
    const parsed = await parsePackageArg(
      "https://example.com/changelog.md",
      mock()
    );

    expect(parsed).toEqual({
      type: "changelog-url",
      repoUrl: null,
      repoName: null,
    });
  });

  it("detects repo URL", async () => {
    const parsed = await parsePackageArg(
      "https://github.com/owner/repo",
      mock()
    );

    expect(parsed).toEqual({
      type: "repo-url",
      repoUrl: "https://github.com/owner/repo",
      repoName: "owner/repo",
    });
  });

  it("detects repo name", async () => {
    const parsed = await parsePackageArg("owner/repo", mock());

    expect(parsed).toEqual({
      type: "repo-name",
      repoUrl: "https://github.com/owner/repo",
      repoName: "owner/repo",
    });
  });

  it("detects package name", async () => {
    const getPackageRepoUrl = mock().mockResolvedValue(
      "https://github.com/owner/package"
    );

    const parsed = await parsePackageArg("package", getPackageRepoUrl);

    expect(parsed).toEqual({
      type: "package-name",
      repoUrl: "https://github.com/owner/package",
      repoName: "owner/package",
    });
  });
});
