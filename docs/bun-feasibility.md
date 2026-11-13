# Bun 替换 Rspack 的可行性

核查日期：2026-11-12。范围：本仓库的 Vue CLI 5 + Vue 3 runner；未实施迁移、未进行完整应用性能对比。官方资料使用当日 `oven-sh/bun` 主分支，可能领先于本地 Bun 1.4.2。

## 结论

技术上能迁移，但 Bun bundler 不能作为 Rspack 的直接替换。当前 runner 的核心价值是读取已有 Vue CLI/Webpack 配置并复用 loader/plugin；换 Bun bundler 后，需要重建主要适配层。对现有项目，收益尚无实测依据，代价确定且较高。更小的实验是先保留 Rspack，只将 Node 运行时换成 Bun；这与替换打包器是两件事。

| 方案 | 可行性 | 潜在收益 | 主要代价 |
| --- | --- | --- | --- |
| 仅 `bun install`，仍由 Node + Rspack 运行 | 可单独试验 | 依赖下载/安装速度；不会直接改善 HMR 编译 | 锁文件、安装生命周期与原生依赖安装行为验证 |
| Bun 运行现有 Rspack runner | 原理可行，本机最小原生编译路径通过 | CLI 启动和 JS 编排可能改善 | Vue CLI、模块加载拦截、原生依赖、Sass 子进程、Vitest/打包分发均需回归；Rspack 核心仍是原生编译，不会自动换成 Bun bundler |
| Bun bundler + Bun 开发服务器 | 需另写后端适配器 | 原生 JS/TS/CSS 打包、一体化 server、可能减少依赖，简化独立可执行文件 | Vue SFC、HMR、Webpack 配置/loader/plugin、样式与资源、代理、缓存与懒编译语义、生产产物全部重验 |

## 官方能力与项目影响

- **文件监听与 HMR 有基础能力。** `bun build --watch` 支持监听与增量重建；`Bun.serve` HTML imports 开发服务器默认开启 HMR。其 `import.meta.hot` API 参考 Vite，但官方仍标为进行中：`invalidate`、`send` 未实现，`prune` 回调尚不调用。没有 `accept` 边界或框架插件时会整页刷新。因此不能从“有热更新”推导出“Vue 单文件组件可直接保持状态热更新”。[Bundler](https://github.com/oven-sh/bun/blob/main/docs/bundler/index.mdx)、[HMR](https://github.com/oven-sh/bun/blob/main/docs/bundler/hot-reloading.mdx)、[Fullstack](https://github.com/oven-sh/bun/blob/main/docs/bundler/fullstack.mdx)
- **Vue SFC/Sass 不是内置编译链。** 官方 built-in loaders 清单没有 `.vue`、`.scss`；插件文档明确以 `.scss` 为需要扩展的例子。需评估第三方插件或以 `@vue/compiler-sfc`/Sass 写适配，覆盖 script setup、TS、template、scoped CSS、CSS modules、外部样式依赖与错误定位。本次没有核查并承诺任何第三方 Vue 插件的完整兼容性。[Loaders](https://github.com/oven-sh/bun/blob/main/docs/bundler/loaders.mdx)、[Plugins](https://github.com/oven-sh/bun/blob/main/docs/bundler/plugins.mdx)
- **Webpack 接口不能原样复用。** Bun 的插件接口是 `setup`、`onResolve`、`onLoad`、`onStart`、`onEnd` 等；本仓库是 Vue CLI `resolveWebpackConfig()`、Webpack rule/use 与 compiler hooks。需要翻译配置并重新接入 Vue、auto-import、组件注册、Element Plus、SVG sprite、Babel、Sass/PostCSS、HTML 模板与 public 资源，而非将 `rspack(config)` 改成 `Bun.build(config)`。[Bun 插件接口](https://github.com/oven-sh/bun/blob/main/docs/bundler/plugins.mdx)、[本地适配器](../src/adapter.cjs)
- **原生 CSS、TS、拆包已有能力，但语义须对齐。** Bun 内置 CSS 使用 LightningCSS；有 TS/TSX 转译、tree shaking 和 `splitting`，动态 `import()` 可产生 chunk。但拆包不等于 Rspack 的“浏览器访问页面时才编译”。官方 fullstack 文档的生产模式首次 HTML 请求打包并在内存中缓存，也不能直接等同本仓库按 Vue 页面懒编译及跨进程持久缓存。[CSS](https://github.com/oven-sh/bun/blob/main/docs/bundler/css.mdx)、[Bundler](https://github.com/oven-sh/bun/blob/main/docs/bundler/index.mdx)、[Fullstack](https://github.com/oven-sh/bun/blob/main/docs/bundler/fullstack.mdx)
- **Bun runtime 支持 Node-API，不保证所有 Node 行为一致。** 官方称多数 Node-API 扩展可用，Node compatibility 页面仍有部分实现。尤其本 runner 用到 `Module._load` 拦截，需完整验证。[Node-API](https://github.com/oven-sh/bun/blob/main/docs/runtime/node-api.mdx)、[兼容状态](https://github.com/oven-sh/bun/blob/main/docs/runtime/nodejs-compat.mdx)
- **独立可执行文件是实际可评估的收益。** `bun build --compile` 能包含 Bun runtime，可嵌入资产与 `.node` 文件，并提供跨平台目标。但本仓库动态查找目标项目的依赖、tsrs/Sass 平台程序及 Vitest 仍需专项处理；不能从简单 CLI 编译推导出本 runner 可以无修改分发。[Executables](https://github.com/oven-sh/bun/blob/main/docs/compiler/executables.mdx)、[本仓库分发脚本](../scripts/build-executable.cjs)
- **安装器可独立使用。** Bun 安装器默认不执行任意依赖生命周期脚本，使用信任名单；对原生工具安装需检查相关行为。安装更快不等于业务代码编译更快。[Lifecycle scripts](https://github.com/oven-sh/bun/blob/main/docs/pm/lifecycle.mdx)

## 本机小实验的边界

主任务在 Bun 1.4.2 验证了 `require('@rspack/core')` 后最小 data URI 入口的 `compiler.run/close` 成功，说明此机器的 Rspack 原生绑定可在 Bun runtime 装载。尚未验证完整 Vue CLI runner、真实浏览器、完整生产构建。

主任务也验证无插件 `Bun.build` 对 `.vue`/`.scss` 返回 `success: true`，但产物是 JS 入口和按 `file` 处理的原始资产，并未编译 Vue/Sass；不能把构建返回成功视为 SFC 支持。

现有 [性能记录](compile-performance.md) 的组件编辑编译范围为 84–195 ms，持久缓存后启动编译约 1.53 s。它们只是既有环境里的编译测量，既不是 Bun 对照，也不代表保存到浏览器显示的总延迟；不能据此给出 Bun 提速倍数。

### Bun runtime + Rspack 的目标项目启动验证

2026-11-12 在 macOS arm64、Bun 1.4.2 执行：

```sh
bun src/cli.cjs run --project /Users/malphite/Desktop/幂次科技/项目/assets-supervision-ui --host 127.0.0.1 --port 18087
```

Vue CLI 配置读取与适配完成，但 `RspackDevServer.start()` 初始化代理 middleware 时失败：`follow-redirects@1.16.1` 的 `CustomError` 构造函数调用 `Error.captureStackTrace(this, this.constructor)`，抛出 `TypeError: First argument must be an Error object`。测试进程随后已停止，未修改运行代码或依赖。

进一步最小验证：`require('follow-redirects')` 单独在 Node/Bun 下都成功；先加载 Rspack 再加载该依赖也成功；先 `await createConfig({project})` 再加载该依赖，在 Node 26.13.0 成功、Bun 1.4.2 失败。配置初始化后 `Error.prepareStackTrace` 被 Babel 的 `stackTraceRewriter` 替换，但清除该回调仍未消除错误，所以尚不能归因于这个回调本身。当前结论是存在与项目初始化相关的运行时兼容阻塞，不能宣称可直接切换。

本轮没有完成 Bun 下的完整开发服务器启动、业务编译或浏览器 HMR 验证，也没有可用的 Node/Bun 性能对照。保留 Rspack 的组合仍值得实验，但需先解决兼容阻塞再测收益；不应承诺多倍编译提速。

## 建议

### 限定目标为 assets-supervision-ui

用户明确 runner 主要运行 `/Users/malphite/Desktop/幂次科技/项目/assets-supervision-ui`。因此不必建设面向任意 Vue CLI 项目的通用 Bun 适配器，可以针对该应用提取固定配置；如果仅替换开发启动命令，也可保留原 Vue CLI 生产构建，不必把 gzip、压缩归档、生产图片处理和库构建纳入第一阶段。但该应用现有的开发功能仍须对齐。

2026-11-12 读取目标项目实际配置与源码后发现：

- 在 `src`、`agilebpm`、`library` 中递归扫描并排除 `build`、`dist`、`node_modules`、`.git`，共 1,021 个 `.vue` 文件；其中 802 个带 TS script、494 个带 SCSS style、514 个带 scoped style，另有一个带 Stylus style。这些是源码文件计数，存在交集，不等于开发入口实际构建的模块数。
- 11 个源码文件含 `require.context()`，涉及 `library/index.ts` 的主题/插件加载、`agilebpm/package/ab-core/index.ts` 的组件/指令注册及 `src/icon/index.ts` 的 SVG 注册等。Bun 1.4.2 最小 browser 构建探针将其保留为 `__require.context(...)`，没有生成 Webpack context 模块；需要构建期转换或改写这些调用。
- `vue.config.js` 的 Sass `additionalData` 全局注入 `~@vab/styles/variables/variables.module.scss`，并使用多组别名、`path-browserify` fallback、Vue runtime compiler、CSS extraction，以及 `/api`、`/es` 的 HTTP/WebSocket 代理。
- `library/build/vuePlugins/unplugins/index.js` 依赖 Vue/Pinia/router 等自动导入、组件扫描与 Element Plus 样式自动导入；`library/build/chainWebpack/svgSprite/index.ts` 约定 `icon-[name]` sprite ID；`sourceInjector/injector.ts` 注入自定义 SFC block 设置 `Component.__source`。这些需要按实际用途保留或证明可省略。

限定单项目降低的是通用配置适配成本，不会自动消除 Vue/Sass/HMR 与 Webpack 源码语义的迁移成本。当前更合适的取舍仍是：稳定开发优先保留 Rspack；如要验证 Bun，先测 Bun runtime + Rspack 的完整启动与端到端热更新，再决定是否值得投资独立 Bun bundler 后端。

当前主线继续使用 Rspack。若要降低启动/安装/分发成本，先做 Bun runtime 与安装器的隔离实验，测同一项目的启动、热更新端到端延迟、内存与可执行文件首启。若仍要换打包器，先验证一个代表性 Vue 页面，至少包含 TS、Sass 全局变量、Element Plus、自动导入、SVG、路由懒加载、代理与组件热更新；所有能力通过后再比较冷/暖启动及生产产物。

Bun 官方也有 [Bun 运行 Vite 的指南](https://github.com/oven-sh/bun/blob/main/docs/guides/ecosystem/vite.mdx)。若目标是改用已有 Vue 集成的生态，可另评估 Vue + Vite + Bun runtime；这仍需要迁移 Vue CLI/Webpack 配置，且并非 Bun bundler。

## 2026-11-13 实施更新

Runner 已迁移到 Bun runtime，保留 Rspack。已通过目标应用的生产构建与开发服务首次编译、21 项回归测试，以及不依赖系统 Node/Bun 的独立包测试（含 Rspack/Sass/tsrs、Vue、jsdom 和覆盖率）。开发服务在 Vue CLI 初始化之前预加载代理依赖，规避上文记录的 `captureStackTrace` 问题；生产 loader 链会移除与 Rspack 不兼容的 `thread-loader`。

Bun 下 jsdom 禁用 VM 内的 HTML script 执行，组件测试和覆盖率通过。额外浏览器冒烟中，静态资源、代理、懒加载和 HMR 消息通过，但组件文字更新在 Node 与 Bun 两条路径均超时；这是已有 HMR 链路问题，不能宣称端到端热更新全部验证通过。
