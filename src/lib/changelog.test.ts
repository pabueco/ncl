import { describe, it, expect, mock } from "bun:test";
import { isChangelogUrl, parseReleasesFromChangelog } from "./changelog";
import { renderRelease } from "./releases";
import { marked } from "marked";

describe("isChangelogUrl", () => {
  it("returns true for changelog URL", () => {
    expect(isChangelogUrl("https://example.com/changelog.md")).toBe(true);
    expect(isChangelogUrl("https://example.com/CHANGELOG.md")).toBe(true);
    expect(isChangelogUrl("https://example.com/changelog-1.md")).toBe(true);
    expect(isChangelogUrl("https://example.com/changelog-3.1.md")).toBe(true);
    expect(isChangelogUrl("https://example.com/CHANGELOG-3.1.md")).toBe(true);
  });
});

describe("parseReleasesFromChangelog", () => {
  it("parses changelog with valid keepachangelog format", async () => {
    const releases = await parseReleasesFromChangelog(
      `
# Changelog

## [1.0.0] - 2024-04-18

### Added
- Foo feature
- Bar feature

### Changed
- Baz feature

## [0.1.0] - 2024-03-01

### Added
- New feature
- Another feature

### Fixed
- Bug fix

## [0.0.1] - 2023-12-30

### Removed
- Old feature
`,
      () => true
    );

    expect(releases).toHaveLength(3);
    expect(releases[0].version).toBe("0.0.1");
    expect(releases[1].version).toBe("0.1.0");
    expect(releases[2].version).toBe("1.0.0");

    expect(await renderRelease(releases[0], marked)).toMatchSnapshot();
    expect(await renderRelease(releases[1], marked)).toMatchSnapshot();
    expect(await renderRelease(releases[2], marked)).toMatchSnapshot();
  });

  it("parses changelog with different format", async () => {
    const releases = await parseReleasesFromChangelog(
      `
# [1.0.0] - 2024-04-18
- Added foo feature
- Fixed bar feature

# [0.1.0] - 2024-03-01
- Added new feature
- Added another feature

# [0.0.1] - 2023-12-30
- Old feature removed
`,
      () => true
    );

    expect(releases).toHaveLength(3);
    expect(releases[0].version).toBe("0.0.1");
    expect(releases[1].version).toBe("0.1.0");
    expect(releases[2].version).toBe("1.0.0");

    expect(await renderRelease(releases[0], marked)).toMatchSnapshot();
    expect(await renderRelease(releases[1], marked)).toMatchSnapshot();
    expect(await renderRelease(releases[2], marked)).toMatchSnapshot();
  });

  it("parses changelog with inconsistent format", async () => {
    const releases = await parseReleasesFromChangelog(
      `
# Changelog

Hello this is my changelog.

## [1.0.0] - 2024-04-18

# Added
- Added foo feature
- Fixed bar feature

### Changed
- Baz feature

### [0.1.0] - 2024-03-01
- Added new feature
- Added another feature

# [0.0.1] - 2023-12-30

### Removed
- Old feature removed
`,
      () => true
    );

    expect(releases).toHaveLength(3);
    expect(releases[0].version).toBe("0.0.1");
    expect(releases[1].version).toBe("0.1.0");
    expect(releases[2].version).toBe("1.0.0");

    expect(await renderRelease(releases[0], marked)).toMatchSnapshot();
    expect(await renderRelease(releases[1], marked)).toMatchSnapshot();
    expect(await renderRelease(releases[2], marked)).toMatchSnapshot();
  });
});
