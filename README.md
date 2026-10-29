# Rspack Runner

Run an existing **Vue CLI 5 + Vue 3** application with an Rspack development server, without editing the application's `package.json`, `vue.config.js`, Babel configuration, or TypeScript configuration.

Rspack Runner reads the target project's Vue CLI configuration, adapts supported Webpack rules and plugins in memory, and starts a separate development server. It is an experimental development runner for evaluating Rspack alongside an existing Vue CLI setup.

## Features

- **Reuse project configuration.** Load Vue CLI environment files, `chainWebpack`, `configureWebpack`, aliases, and supported loader options through the project's own Vue CLI service.
- **TypeScript with tsrs.** Replace `ts-loader` with a runner-owned loader for TypeScript, TSX, and Vue TypeScript blocks, with syntax diagnostics and composed source maps.
- **Fast incremental compilation.** Enable memory and persistent filesystem caching, with configuration files, lockfiles, extended TypeScript configurations, and custom loaders included in cache invalidation.
- **Lazy Vue page compilation.** Defer dynamically imported `.vue` files under `src/views` and `agilebpm/package` until requested, while compiling entries immediately.
- **Embedded Sass.** Use the runner's modern Sass compiler while adapting legacy Sass options, injected variables, and Webpack-style aliases.
- **Existing development workflows.** Keep hot module replacement (HMR), API proxy rules, WebSocket proxy options, public assets, and SPA history fallback.
- **Selected plugin adapters.** Adapt common Webpack plugins and supported unplugin integrations, including auto imports, component registration, `defineOptions`, and Element Plus.
- **Inline SVG sprites.** Preserve symbol IDs for JavaScript-imported sprites using the target project's SVG tooling and runtime.
- **Directory tests with Vitest.** Run every matching test under a selected directory with the runner's bundled Vitest.
- **Standalone command.** Package Node, the runner, and production dependencies into a single executable.

## Requirements

- Node.js **26.13.0 or later** for running from source. The standalone executable includes Node **26.13.0** and needs no system Node installation.
- For `run` and `build`, an existing **Vue CLI 5 + Vue 3** application with its dependencies already installed and a readable `tsconfig.json`. `test` also works in directories without Vue CLI.
- A platform supported by the pinned tsrs prebuilt binaries: macOS arm64 or Linux x64/arm64.

The target project supplies Vue CLI, Vue Loader, Babel, PostCSS, and its application-specific loaders and plugins. Rspack Runner supplies Rspack, its development server, tsrs, the default Sass toolchain, and Vitest **5.0.5**.

The current runner pins Rspack **1.7.12**, Rspack Dev Server **1.2.1**, tsrs **0.18.0-ts7.1.0-dev.20260929**, sass-loader **16.0.6**, and sass-embedded **1.105.0**.

## Quick Start

Clone and install the runner:

```sh
git clone https://github.com/PuTongjian/rspack-runner.git
cd rspack-runner
npm ci
```

Start a target application using an absolute or relative project path:

```sh
node src/cli.cjs run --project /path/to/your-vue-cli-app --port 8087
```

Open <http://localhost:8087>. The browser is not opened automatically. Stop the server with `Ctrl+C`.

You can also run the CLI from the target application's directory, in which case `--project` defaults to that directory:

```sh
cd /path/to/your-vue-cli-app
node /path/to/rspack-runner/src/cli.cjs run --port 8087
```

Use a different port from the application's original Webpack server to run both side by side.

The repository also includes an application-specific shortcut:

```sh
# Requires an installed Vue CLI application at ../assets-supervision-ui.
npm run demo

# Override the demo port.
npm run demo -- --port 8088
```

The CLI can also build the current project into its `dist` directory:

```sh
rspack-runner build
```

## Standalone Executable

Build for the current platform:

```sh
npm run build:executable
npm run test:executable
./dist/rspack-runner --help
```

The build downloads the Node version pinned in `.node-version`, verifies its SHA-256 against the official release checksums, installs production dependencies in an isolated staging directory, and embeds everything in a Node single executable application. It supports macOS arm64 and Linux x64/arm64; build on the target platform so native dependencies match. macOS builds require `codesign` for ad hoc signing.

Distribute just `dist/rspack-runner`. No separate Node, npm, or runner dependency installation is required. The first launch extracts the bundled runtime and dependencies to `~/.cache/rspack-runner/runtime/<payload-hash>`; later launches reuse it. A writable home directory and space for the extracted dependencies are required. Builds have separate caches; remove old runtime directories when no command is using them. The executable is not notarized for macOS distribution.

To make it available on your PATH:

```sh
mkdir -p ~/.local/bin
cp dist/rspack-runner ~/.local/bin/rspack-runner
# Ensure ~/.local/bin is on your PATH.
```

Homebrew also builds and installs this standalone executable; Node is only a build dependency.

Homebrew requires formulas to live in a tap. To test this formula locally:

```sh
brew tap-new local/rspack-runner
mkdir -p "$(brew --repository)/Library/Taps/local/homebrew-rspack-runner/Formula"
cp Formula/rspack-runner.rb "$(brew --repository)/Library/Taps/local/homebrew-rspack-runner/Formula/"
brew install --HEAD --build-from-source local/rspack-runner/rspack-runner
```

For a shared installation, put `Formula/rspack-runner.rb` in a GitHub repository named `homebrew-rspack-runner`, then install it with `brew tap <account>/rspack-runner` followed by `brew install --HEAD <account>/rspack-runner/rspack-runner`. The formula tracks this repository's `main` branch.

The repository also provides npm commands for managing the default local tap (`local/rspack-runner`):

```sh
npm run brew:install   # package the current local source and install the command
npm run brew:update    # package the current local source and reinstall
npm run brew:uninstall # uninstall the command and remove the local tap
```

`brew:uninstall` removes this formula and its dedicated local tap; it does not uninstall Homebrew itself. Set `RSPACK_RUNNER_TAP=owner/repository` before install/update if you use another tap.

The npm install/update helpers create a complete source archive under `.cache/brew` and generate a local tap formula with its file URL and SHA-256. This includes uncommitted and new source files, so local changes do not need to be pushed before installation. Keep that cache for direct `brew reinstall` calls, or run the npm helper to create a fresh archive. Use the repository's `Formula/rspack-runner.rb` for a shared remote tap; the generated local formula refers to files on this machine.

The installed command always uses the current working directory as the project unless `--project` is supplied. `run` is the user-facing name for the development server; `dev` remains an alias.

## CLI Options

```text
rspack-runner <run|build> [options]
rspack-runner test [DIRECTORY] [--project PATH] [--config PATH]
```

| Option | Default | Behavior |
| --- | --- | --- |
| `--project PATH` | Current directory | Target Vue CLI application, or test project root. |
| `--config PATH` | Vitest config discovery | Vitest configuration file, relative to the test project root; only for `test`. |
| `--mode NAME` | `development` for run, `production` for build | Select the Vue CLI environment mode and its `.env` files. |
| `--port NUMBER` | Project `devServer.port`, otherwise `8080` | Development server port, from 1 to 65535. |
| `--host HOST` | `localhost` | Development server bind address. |
| `--no-lazy` | Lazy compilation enabled | Compile matching dynamic Vue imports eagerly. |
| `--no-persistent-cache` | Persistent cache enabled | Disable disk caching while retaining memory caching. |
| `--no-embedded-sass` | Embedded Sass enabled | Retain the target project's Sass loader and compiler. |
| `--no-eval` | Eval-based source maps enabled | Use `cheap-module-source-map` for environments whose CSP blocks `eval`. |
| `--help`, `-h` | | Print usage. |

`run` starts the development server. `dev` is kept as an alias. `build` performs a production compilation and writes `dist` inside the target project. `--mode` selects Vue CLI configuration and environment files.

For example:

```sh
node src/cli.cjs run --project ../my-app --mode staging --port 8087 --no-eval
```

## Running Tests

```sh
# Run all tests under the current project.
rspack-runner test

# Recursively run tests in a selected directory.
rspack-runner test ./tests
rspack-runner test /absolute/path/to/tests

# Resolve the directory and config relative to a different project root.
rspack-runner test tests/unit --project /path/to/app
rspack-runner test test/e2e --config vitest.e2e.config.mjs
```

Tests run once and the command exits: success returns `0`; failing tests, missing directories, or no matching files return a nonzero status. By default Vitest discovers `*.test.*` and `*.spec.*` files in JavaScript/TypeScript (including JSX/TSX and ESM variants). Existing `vitest.config.*` or `vite.config.*` files are discovered at the project root, and their include/exclude patterns, environments, setup files, and plugins still apply within the selected directory. Config files use Node's native loader and TypeScript stripping; `vitest/config` and `vite` helpers fall back to the runner's dependencies. TypeScript syntax that requires code generation (such as enums) is unsupported in config files.

Tests can import `test`, `expect`, and other APIs from the bundled `vitest` without installing Vitest in the target project. Application dependencies and optional test tools such as Playwright, jsdom, and Vue plugins must be installed in that project when needed; browser binaries are not included.

```js
import { test, expect } from 'vitest'

test('adds two numbers', () => {
  expect(1 + 2).toBe(3)
})
```

## How Configuration Is Adapted

The runner initializes the target project's Vue CLI service and resolves its Webpack configuration. It then adapts that configuration before passing it to Rspack:

| Area | Adaptation |
| --- | --- |
| TypeScript | Replace `ts-loader` with the runner's tsrs loader. |
| Babel and PostCSS | Reuse the target project's configuration and dependencies; move Babel caching into the runner and disable cache compression. |
| Sass | Use the runner's embedded modern compiler by default, preserving supported project options. |
| Define, Provide, Banner, and CSS extraction | Replace recognized Webpack plugins with Rspack equivalents. |
| HTML | Use the runner's pinned `html-webpack-plugin`. |
| Public directory | Serve assets directly through the development server instead of CopyPlugin. |
| Supported unplugin modules | Select their Rspack factories while Vue CLI evaluates configuration, preserving supplied options except declaration-generation settings. |
| Development server | Adapt proxy configuration and enable HMR, static serving, history fallback, and lazy-compilation middleware. |

The recognized unplugin integrations are `unplugin-auto-import`, `unplugin-vue-components`, `unplugin-vue-define-options`, and `unplugin-element-plus`. Their installed versions must expose a compatible Rspack factory, or a supported raw factory. Auto-import and component declaration generation is disabled, as is auto-import ESLint declaration generation. The temporary Node module-loading interception is restored after configuration resolution.

## Caching and Performance

By default, the runner enables:

- Rspack memory and persistent filesystem caches.
- Lazy compilation for the Vue page paths described above.
- `eval-cheap-module-source-map` source maps.
- Uncompressed Babel caching.
- A reusable embedded Sass modern compiler.

Caches are stored inside the runner checkout:

```text
.cache/<project-path-hash>/rspack/
.cache/<project-path-hash>/babel-uncompressed/
```

Development bundles are served from memory. The first run populates caches, and opening a deferred page for the first time incurs a compilation wait. Disk caches can grow substantially. Stop the server before deleting a project's cache directory, and avoid running multiple runner compilers against the same project cache simultaneously.

Restart the server after changing project configuration or `tsconfig.json`. The runner tracks these inputs for cache invalidation on restart; it does not reload all configuration in a running process.

Use the `--no-*` options individually to compare behavior or investigate compatibility issues.

Recorded measurements on the reference application reduced the initial Rspack compilation from about **14.14 s to 5.12 s**, a subsequent process-start compilation to **1.53 s**, and the median single-component edit compilation from **13.25 s to 110.5 ms**. These are application-specific compiler timings with warmed OS/Babel caches, exclude first visits to deferred pages, and do not measure browser-visible HMR latency or guarantee equivalent results elsewhere.

See [the performance investigation](docs/compile-performance.md) and [source references](docs/performance-sources.md) for methodology and raw results. These research notes are currently in Chinese. The benchmark harness expects the sibling `../assets-supervision-ui` application:

```sh
node scripts/benchmark-compile.cjs optimized
```

Run it again to compare persistent-cache reuse across processes.

## Validation

Run the automated adapter, loader, and compilation tests:

```sh
npm test
```

The suite covers proxy conversion, nested loader adaptation, CLI validation, tsrs output and diagnostics, cache invalidation, Sass compatibility, and lazy-compilation middleware with hot-update assets.

It also checks directory-scoped Vitest execution, nested JS/TS discovery, configuration loading, and failure exit codes. `npm run test:executable` verifies the packaged binary with no system Node on PATH, including its Rspack, Sass, and tsrs native dependencies.

An additional browser smoke script uses the reference application's configuration and dependencies:

```sh
node test/smoke.cjs /path/to/assets-supervision-ui
```

It creates a temporary Vue + TypeScript + SCSS fixture inside the runner's cache directory and checks HTML/static serving, SVG sprites, auto imports, Element Plus, proxy rewriting, lazy-page activation, HMR WebSocket messages, and browser DOM updates. It assumes reference-specific assets, styles, and plugins, so it is not a generic smoke test for every Vue CLI application. The default browser path is macOS Google Chrome; set `PLAYWRIGHT_EXECUTABLE_PATH` to use another compatible browser installation.

`npm run test:e2e` runs a separate application-specific asset-disposal workflow against an already running reference application. See [the E2E instructions](test/e2e/README.md) for login-state and environment settings. It is not part of the generic runner test suite.

## Compatibility and Limitations

- **Vue CLI applications only.** Library mode and arbitrary Webpack projects are not implemented.
- **Vue CLI internals.** Configuration resolution relies on Vue CLI 5 internal APIs, and plugin compatibility depends on the target project's installed versions.
- **Transpilation only.** tsrs reports syntax diagnostics but does not perform cross-file type checking. Run the application's type-check command separately. Keep its TypeScript dependency if Vue CLI or other plugins require it.
- **TypeScript emit behavior.** The runner reads `tsconfig.json`, including `extends`, and forwards selected single-file emit options. It ignores the legacy `suppressImplicitAnyIndexErrors` option in memory, raises targets below ES2015 to ES2015, and lets Rspack resolve imports and aliases. Full ES5 compatibility is not promised; Babel still applies the project's JavaScript transforms afterward.
- **Explicit plugin support.** Unknown named plugins cause an error and need an explicit adapter. Anonymous object plugins are retained and require validation against the target application.
- **Omitted plugins.** CaseSensitivePaths, FriendlyErrors, WebpackBar, and ForkTsChecker are omitted, with notices printed at startup.
- **SVG scope.** The sprite adapter supports JavaScript-imported inline sprites and preserves `symbolId`. `extract: true` is unsupported.
- **Warnings.** The terminal suppresses individual compilation warning messages, including existing Vue and Sass deprecation warnings.

This runner provides a way to evaluate an existing application's development workflow with Rspack. Compatibility must be checked against that application's actual loaders, plugins, styles, and browser behavior before adopting it.
