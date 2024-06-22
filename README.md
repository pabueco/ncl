# ncl

> nice changelog

ncl provides a quick and easy way to view the relevant changelog entries or GitHub releases for dependencies or general GitHub repositories. The main goal was to make dependeny upgrades a bit easier, but you can also use it to explore and discover changes of any GitHub repository.

Since it's aimed at locally installed packages, it makes use of the available package managers on your system to retrieve infos like repository URL and the installed version number of dependencies.

Currently the following package managers are supported:

`npm`, `pnpm`, `yarn`, `bun`, `composer`, `cargo`

You can work around unsupported package managers by providing the repository name or URL and version (optional) yourself. Support for more package managers will be added in the future.

## Installation

You can easily run `ncl` via `npx` (or alternatives like `bunx` and `pnpx`):

```sh
# Run it directly
npx @pabueco/ncl <args>

# or install it globally to remove the need for the scope:
npm i -g @pabueco/ncl
npx ncl <args>
```

> [!NOTE]  
> If you want to view GitHub releases for repositories, you need to have the [GitHub CLI](https://cli.github.com/) installed.

## Usage

```sh
# Basic fingerprint:
ncl <package> [<version-or-range>]

# Viewing the changelog entries between the locally installed and the latest available version:
ncl <pkg>

# Locally installed version up until version 4.x:
ncl <pkg> ..4.x

# Version 2 - 4
ncl <pkg> 2..4

# Only version 3.5.x
ncl <pkg> 3.5

# All versions from 4
ncl <pkg> 4..

# You can also use more complex semver ranges, but they need to be escaped in most terminals:
ncl <pkg> "\>2.3 \<=2.8"
```

When specifying a version range you can use between 2 and 4 dots (e.g. `2..3` or `2....4`), so use what feels best for you.

### Advanced usage

```sh
# View changes of any repo without needing to have the dependency installed locally:
ncl vuejs/core
ncl https://github.com/vuejs/core
ncl https://raw.githubusercontent.com/vuejs/core/main/changelogs/CHANGELOG-3.2.md

ncl vuejs/core 3.x

# Change the order of changes:
ncl <pkg> --order desc

# Print all changelog entries once instead of viewing them interactively:
ncl <pkg> --list
```

### Options

There are a few options available to configure the behaviour if you want to.

Run `ncl --help` to see all available options.
