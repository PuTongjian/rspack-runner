# tsrs 作为 Rspack TypeScript 转译器的可行性

核查日期：2026-10-22。官方仓库快照：`357d1d3ec23180eae94a8485b8b7444487a7ea5f`。

实现进展（2026-10-22）：runner 现已默认使用固定版本 tsrs loader；`npm run demo` 无需新增选项。6 项自动测试通过，涵盖 TS/TSX、枚举、source map 合成、语法错误、旧配置和无 TypeScript 依赖的 Rspack fixture。最终代码的实际业务项目离线编译通过，3,191 个模块经过 tsrs loader，约 14.0 秒（非与旧版对照的速度测量）。Vue + SCSS + 自动导入 + Element Plus 的 watch 增量编译和 hot-update JS 产物验证也通过。本轮未编辑目标项目；Dev Server 的 HTTP/WebSocket smoke 因本地端口权限及审批服务故障尚未执行，原项目已有 Vue Loader 路径修正得以保留。以下调查中的“尚未集成”及插件错误描述为接入前记录。

## 结论

**可以通过 runner 自定义 loader 使用 tsrs 编译 TypeScript，不必修改 assets-supervision-ui 的代码或配置。** 不能把“没有现成的 webpack/Rspack loader”理解为“tsrs 只能检查类型”。tsrs 有完整的 JavaScript emit 和单文件转译 API。

当前 runner 的 `ts-loader` 不能只将 `compiler` 改成 `tsrs` 就继续工作：tsrs 的包根入口只导出版本信息，新的 Node API 与 TypeScript 4/5 的 compiler API 不兼容。应替换 loader 本身，并继续使用 Vue Loader 处理 SFC。

## 官方证据

1. [USAGE.md](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/docs/USAGE.md) 明确区分 `tsrs -p path/to/project`（编译）和 `--noEmit`（仅检查类型），默认按 tsconfig 输出 JavaScript 和声明。
2. [EMIT.md](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/docs/EMIT.md) 记录完整 emit 管线，包括类型擦除、运行时 TypeScript 语法、JSX、ECMAScript 降级、模块转换、source map、声明和增量构建。
3. [NODE_API.md](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/docs/NODE_API.md) 提供 `tsrs/unstable/sync` 和 `tsrs/unstable/async`，示例直接调用 `project.program.emit()`；支持矩阵将 `transpileModule`、`transpileModuleFromFile`、`emit`、`emitToString` 标为 supported。
4. [transpile.rs](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/crates/tsrs_api/src/transpile.rs) 是真实的编译实现：接收源码、文件名和 compiler options，在内存构建单文件 program，调用 `Program.emit`，返回 `outputText`、`sourceMapText`、diagnostics。它会设置 `no_check`、`no_resolve`，通常设置 `isolated_modules`，因此适合 loader 的单文件转译流程，无需扫描整个旧项目 tsconfig 的 include。
5. [transpile_test.rs](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/crates/tsrs_api/tests/transpile_test.rs) 验证删除 `number` 类型、把 enum 转成运行时 JS、语法错误和 source map；这不是只返回源码的占位接口。
6. [npm package.json](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/npm/tsrs/package.json) 明确导出 unstable sync/async API；根入口是 `lib/version.cjs`，不是旧版 `typescript` API。

## 适合本项目的接法

```text
普通 .ts/.tsx ───────────────────────────┐
                                        ▼
Vue SFC → vue-loader → 虚拟 TS script → runner 自定义 tsrs loader
                                        ↓
                            tsrs API.transpileModule
                                        ↓
                               JavaScript + source map
                                        ↓
                         现有 Babel（如仍需要）→ Rspack
```

- 把固定版本的 `tsrs` 安装在 rspack-runner，所有加载路径由 runner 解析。
- 只在内存中替换目标项目生成的 `ts-loader` use 项，保留 Vue Loader、自动导入插件和 Babel 的顺序。
- 传给 API 的 `fileName` 应反映 TS/TSX 语法；Vue 虚拟 script 模块也需要 `.ts`/`.tsx` 文件名语义。
- 复用 API session，避免每个模块启动一个 tsrs 进程；compiler 关闭时调用 `api.close()`。
- 返回和衔接 source map；语法错误作为 loader error 报告。
- Rspack 继续负责依赖解析和路径别名，单文件转译无需 tsrs 解析完整依赖图。

这里描述的是可行的集成方案，尚不等于当前项目已完成整站验证。

## 最小实验结果

本次另外使用 npm 发布包 `tsrs@0.18.0-ts7.1.0-dev.20260929` 做了隔离实验：

- `API.transpileModule` 成功转换 TS 类型和 enum，并返回 source map。
- Vue 3 `compiler-sfc.compileScript` 处理 `<script setup lang="ts">` 后，其输出可继续由 tsrs 编译。
- 临时 async API loader `/tmp/tsrs-verify.djnjno/loader.cjs` 接入实际 Rspack 1.7.12，复用目标项目的 vue-loader 17.4.2，成功打包 TS entry 和 Vue script setup；生成的 `app.js` 为 498975 字符，检查确认 TS 类型语法已被删除。

这是实际 loader 与 Rspack/Vue 链路验证，不是完整 demo 验证。临时 loader 未实现输入 source map 的合成，不能视为生产适配完成；既有 `Unsupported plugin Plugin` 仍未修复。本次仓库内仅新增这份研究文档，未编辑 assets-supervision-ui。

## 限制和需要验证的内容

### 转译速度实测

2026-10-22 在本机以 TypeScript 4.9.5 和 tsrs 0.18.0 比较 `transpileModule`。输入为目标项目 `src`、`library`、`agilebpm` 中的 264 个非声明 TS/TSX 文件，以及抽样 Vue SFC 经 `compileScript` 提取的 106 个 TS script，共 370 个模块、1,152,013 字节。两者使用相同 ES2022、ESNext module、sourceMap、importHelpers 和 useDefineForClassFields 选项；关闭 diagnostics。tsrs 使用持久 async API，计时包含逐文件 IPC，依次 await。先各预热 30 个模块，再交替执行 5 轮。

| 转译器 | 5 轮耗时（ms） | 中位数（ms） |
| --- | --- | --- |
| TypeScript 4.9.5 | 709、580、658、530、494 | 580 |
| tsrs 0.18.0 | 128、118、126、128、118 | 126 |

此样本的单文件转译环节约快 4.6 倍，耗时减少约 78%。实验脚本位于 `/tmp/tsrs-verify.djnjno/bench.mjs`。未计入输入读取、Vue SFC 解析、进程冷启动、Babel、Sass、Rspack 打包和 HMR；没有执行完整项目依赖图，也没有验证全部输出的行为等价。原项目目标是 ES5，本次为双方支持的 ES2022 对照，不能直接据此宣称整个 demo 快 4.6 倍。

- **TypeScript 7 与旧配置存在差异。** [COMPATIBILITY.md](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/docs/COMPATIBILITY.md) 明确写明拒绝 TS7 已删除的 ES5 target、AMD/UMD/System、baseUrl 等。目标项目的 `target: es5` 和 `suppressImplicitAnyIndexErrors` 不能原样交给完整 TS7 编译。应在 runner 的内存 compiler options 中移除旧选项，并选 ES2015+ 转译目标；仍需 ES5 时，再验证现有 Babel 的降级结果。
- **单文件转译不是完整类型检查。** 它与当前 `transpileOnly` 的职责相同；跨文件类型分析需要另设检查流程。
- **Node API 标为 unstable。** 官方指出协议覆盖仍有缺口，并且不兼容 TS5 `createProgram` 对象；应锁版本并做真实编译与热更新验证。
- **Vue 仍需要 SFC 处理器。** tsrs 已有通过 `contentMappers` 把 `.vue/.svelte/.astro` 转为虚拟 TS 的 CLI 能力，但这不是现成 Vue runtime bundler。源码与 [EMIT.md](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/docs/EMIT.md) 表明 content-mapped 文件不直接输出运行时 JS；[contentmappers.md](https://github.com/oxc-project/tsrs/blob/357d1d3ec23180eae94a8485b8b7444487a7ea5f/notes/contentmappers.md) 还记录 API project system 的 mapper host 未移植。因此本项目更适合保留 vue-loader，调用 transpileModule 处理其输出。
- **兼容配置读取和编译依赖是不同问题。** Vue CLI 初始化、Vue compiler-sfc 的类型宏解析或其他插件仍可能加载目标项目的 `typescript`。替换 ts-loader 能把运行时 TS→JS 编译交给 tsrs，但是否能彻底做到进程从不加载项目 TypeScript，需要额外跟踪并验证，不能仅凭替换 loader 承诺。
- 当前 runner 的 `Unsupported plugin Plugin` 是先于 TS 转译的独立适配问题；完成 tsrs 接入前后都需解决或隔离，才能验证整站启动。

## 核查范围

本笔记直接阅读上述固定 commit 的官方代码、测试和文档。部分 notes 含历史状态（例如旧文提到 watch 尚未实现，而当前兼容表已支持 watch）；以当前兼容表和实际源码为优先。未修改 assets-supervision-ui，未宣称已通过该项目的完整 tsrs 编译。
