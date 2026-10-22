# 编译及热更新优化：版本核对与来源

核查日期：2026-10-22。目标是只改 `rspack-runner` 的内存适配，不修改 `assets-supervision-ui`。本文为源码调查，不包含性能收益承诺；对照测量另见性能报告。

本地已安装版本：Rspack 1.7.12、Vue CLI 5.0.9、Vue Loader 17.4.2、sass-loader 13.3.3、Dart Sass 1.105.0、babel-loader 8.4.1。引用已安装发布包代码，是为了避免把当前在线文档的新版本默认值套用到这些版本。

## 1. 优先恢复 Rspack 缓存

runner 的 `src/adapter.cjs:114` 显式 `config.cache = false`。Rspack 1.7.12 的 `node_modules/@rspack/core/dist/index.js:5869` 会进一步把 `experiments.cache` 设成 false。`index.js:5923` 的 development 默认是开启缓存，这意味着 runner 主动关闭了原本可用的缓存。

建议先对照 `cache: true` / `experiments.cache: {type:'memory'}`，重点量模板、脚本、样式的二次编译。它主要改善同一进程重编译，不等于重启之后的持久缓存。

持久缓存在此版本的类型与实现中确实存在：`dist/config/types.d.ts:1930` 和 `dist/index.js:6563` 支持 `experiments.cache: {type:'persistent', buildDependencies, version, storage:{type:'filesystem',directory}}`。存储目录须放 runner 的 `.cache`，不要使用默认目标项目 `node_modules/.cache/rspack`。还需覆盖 runner loader、项目配置、锁文件和 tsrs 编译选项的失效关系。

来源：[Rspack v1 cache 文档](https://v1.rspack.rs/config/cache)、[experiments 文档](https://v1.rspack.rs/config/experiments)，版本细节以本地 1.7.12 源码为准。

### 持久缓存的额外失效来源

`assets-supervision-ui/vue.config.js:28` 每次产生 `lastBuildTime`，并注入 `VUE_APP_INFO`、`VUE_APP_UPDATE_TIME`、`VUE_APP_RANDOM`，同时 Banner 与 `__APP_INFO__` 也含时间。重启后这些 Define/Banner 值变化可能使缓存模块或产物失效。不能只打开磁盘缓存就承诺整站重启接近零耗时。要先测缓存命中和失效原因；稳定开发时间戳会改变展示的构建时间语义，需作为单独方案评估。

## 2. 增量功能多数已默认启用，避免重复“优化”

Rspack 1.7.12 `dist/index.js:5923` 已给 `experiments.incremental` 的 make、providedExports、module/chunk id、hash、codegen、runtime requirements、chunk render、asset emit 等设置 true；`buildChunkGraph` 是 false。`incremental: true` 通常只是重述既有默认值，不能把它作为独立预期收益。激进开启 chunk graph 增量需要验证旧 Webpack/Vue/unplugin 的兼容性。`safe` preset 反而关闭多数增量 pass，不能以名称推断更快。

来源：已安装 `dist/config/types.d.ts:2006`、`dist/index.js:6652`，以及 [Rspack v1 experiments 文档](https://v1.rspack.rs/config/experiments)。

## 3. TS/TSX Babel 缓存仍有压缩开销

实际解析后的 JS Babel rule 已有 `cacheCompression:false`，来自 `@vue/cli-plugin-babel/index.js:112`。但 TS/TSX rule 由 TypeScript 插件另外插入 Babel，当前只有 runner 注入的 `cacheDirectory`，没有 `cacheCompression:false`。

babel-loader 8.4.1 `lib/index.js:160` 默认 `cacheCompression=true`，`lib/cache.js:35`、`:49`、`:68` 对缓存读写调用 gunzip/gzip。因此只对 TS/TSX 补上 false 是具体可测优化，而“给所有 JS 关闭压缩”不是新收益。需要隔离缓存目录再比较，避免混用同名压缩与非压缩缓存造成额外 miss。

来源：[babel-loader caching](https://webpack.js.org/loaders/babel-loader/#options)，本地 Vue CLI Babel 插件与 loader 代码。

## 4. source map 模式值得对照，但保留调试可用性

实际 runner 配置为 `cheap-module-source-map`，来源 `library/build/chainWebpack/index.ts:31`。可以对照 `eval-cheap-module-source-map`：改变产物生成方式，保留 loader source map 与原源码行映射。只做开发环境适配。需要确认 CSP 是否允许 eval、Chrome 调试映射以及热更新行为。

关闭 devtool 同时会使 tsrs loader 的 `sourceMap` 和 `inlineSources` 工作减少，适合作为“source map 成本上限”的诊断实验，但会牺牲断点与错误定位，不能直接作为默认优化。

来源：[Rspack v1 devtool](https://v1.rspack.rs/config/devtool)、runner `src/tsrs-loader.cjs:47`。不同版本文档的默认值可能不同，应比较实际解析值。

## 5. Sass 是潜在的第二个大头

项目为每个 Sass 模块通过 `additionalData` 注入全局 variables.module.scss（`vue.config.js:172`），自动导入的 Element Plus resolver 还指定了 `importStyle:'sass'`（`library/build/vuePlugins/unplugins/index.js`）。这会把样式依赖引向 Element Plus 的 `style/index` / theme SCSS。当前还保留另一个 Components resolver 默认 CSS、以及 Element Plus 样式插件，所以需要统计 Sass 模块来自何处，确认有没有同时引入两种样式路径。

可评估两个方向：

- 在 runner 显式给 sass-loader 注入 `sass-embedded` 实现。sass-loader 13.3.3 `dist/utils.js:43` 允许 implementation 对象并识别 sass-embedded。它默认优先选 sass，因此仅安装 embedded 不会自动切换。更大的潜在收益是升级 runner 自带的 sass-loader，使用支持 `modern-compiler` 的版本以复用 compiler。
- 若页面不依赖定制 Element Plus Sass 变量，runner 适配 resolver 的样式导入为预编译 CSS，可以减少依赖 Sass 编译。必须验证品牌色、暗色、CSS 顺序、tree-shaking 和组件覆盖；这是有样式语义风险的方案，不能当作无损开关。

版本陷阱：当前 sass-loader 13.3.3 schema 的 `api` 仅接受 `legacy` / `modern`；其 `modern` 直接调用 `compileStringAsync`，**不支持 `modern-compiler`**。不能只向旧 loader 塞入新选项。项目的 `outputStyle` 也要映射为现代 API 的 `style`。保留 webpack importer，因为全局注入用了 `~@vab` 别名；盲目 `webpackImporter:false` 会破坏它。

来源：[sass-loader implementation/api](https://webpack.js.org/loaders/sass-loader/)、本地 `dist/options.json:20`、`dist/utils.js:534`；Element Plus resolver 代码 `unplugin-vue-components/dist/resolvers.js:316` 区分 sass 与 css 路径。

## 6. 仅首次编译可考虑按需编译

Rspack 1.7.12 的顶层 `lazyCompilation` 类型支持 `entries`、`imports`、`test`（`dist/config/types.d.ts:1972`），可以从 `{entries:false, imports:true}` 开始，限定业务路由动态 import。未访问页面推迟到访问时编译，可减少启动图；这是成本转移，不是让完整项目所有页面都变快，首次进入新路由可能更慢。

必须在真实浏览器检查懒编译端点、路由、prefetch/preload、代理及 HMR。离线只编出产物不足以验证可用。文档里的 lazyCompilation 默认描述随版本变更，安装版 `index.js:5869` 默认 false，需显式开关对照。

来源：[Rspack v1 lazyCompilation](https://v1.rspack.rs/config/lazy-compilation)。

## 7. CSS 提取与热更新

项目 `css.extract:!islib`，开发也走 CssExtractRspackPlugin。可以在 runner 中试验 Vue style 注入替代 CSS 提取，主要观察样式 HMR 和 CSS 产物重渲染成本。Sass 本身仍要编译，不保证收益；CSS 顺序、样式闪动和插入位置必须做浏览器验证。不能简单删插件而保留抽取 loader。

来源：[CssExtractRspackPlugin](https://v1.rspack.rs/plugins/rspack/css-extract-rspack-plugin)、已安装 sass-loader README:816 的开发 style-loader 示例。

## 8. 低优先级或已做的工作

- 自动导入 dts / ESLint 声明生成已经由 runner 关闭，不应再作为新收益。
- Components 搜索已限定 `library/components`，当前仅 36 个 Vue 文件；其 `searchGlob()` 有 `_searched` 守卫，仅首轮 glob。缩小扫描预计低于缓存/Sass收益。
- 类型检查 ForkTsChecker 已移除，不要把 tsrs 的类型检查线程参数用于当前 `transpileModule` 路径；单文件转译不会执行完整类型检查。
- Babel 仍负责原项目浏览器语法和相关 Babel 行为。移除或换 SWC 是较高风险的下一阶段，需要证明原 Babel 插件、polyfill、JSX、decorator 等行为等价；本次仍以 tsrs 负责 TS 编译为边界。
- 不要盲目设置 `resolve.symlinks:false`：目标 node_modules 是 pnpm 结构，可能影响同一依赖实例、Vue 单例和 Babel include/exclude。需要专门的解析测试。

## 测量口径

至少区分启动首次编译、同进程脚本/模板/样式编辑、共享 SCSS 变量编辑、进程重启。记录 built/cached 模块数、涉及的 Babel/tsrs/Sass 模块数、compiler done 时间、hot-update 大小；浏览器更新时延还需 HTTP/WebSocket 与实际页面确认。本次不修改目标项目，测量入口应为 runner fixture 和同一依赖图。
