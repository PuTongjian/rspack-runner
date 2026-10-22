# 编译与热更新优化调查

2026-10-22，本机 Node 24.14.0、Rspack 1.7.12、tsrs 0.18.0。结论：**先恢复 Rspack 内存缓存，再评估持久缓存及路由懒编译。** 本轮仅添加研究脚本、数据与文档；没有改默认 demo 配置，也没有编辑 assets-supervision-ui。

## 优化实施结果（2026-10-22）

后续已按用户要求实施：`npm run demo` 默认启用内存+持久缓存、业务 Vue 组件懒编译、eval 行级 source map、Babel 非压缩缓存和 runner 自带的 embedded Sass modern compiler；TS 编译仍使用 tsrs。原业务项目未修改。下面原始调研保留为实施前对照。

最终组合的同一基准测量：

| 指标 | 实施前 | 实施后 |
| --- | ---: | ---: |
| 本轮首次 Rspack 编译 | 14.14 s | 5.12 s |
| 持久缓存后的进程重启编译 | 无 Rspack 缓存 | 1.53 s |
| 六次单组件编辑编译中位数 | 13.25 s | 110.5 ms（首轮）；110.5 ms（重启轮） |
| 六次单组件编辑编译范围 | 12.7–14.3 s | 84–195 ms |
| 单组件编辑重建模块 | 14,793 | 11 |
| hot-update JS | 约 1.6 MB | 约 9.9–16.4 KB |

首次约减少64%的编译时间，持久缓存后相对原首次约减少89%。组合实验仍使用预热过的 OS/Babel 文件缓存；不称为全机器冷启动。懒页面的首次访问成本未包含在启动数据内，实际效果取决于访问的路由。

新增 `src/cache.cjs` 追踪配置、锁文件、加载过的项目配置模块、自定义 loader、tsconfig extends 与性能选项；版本/文件改变使持久缓存失效。缓存写在 runner `.cache`，多轮不同配置实验后当前项目缓存约3.2GB，非每次启动固定增长量。

Sass 实现使用 runner `sass-loader@16.0.6` + `sass-embedded@1.105.0`，保留全局注入/主题/提取方式。修复现代 API 对附加 Sass 内容的 `.css` 文件按纯CSS解析的问题。完整 eager 业务图编译通过，392份CSS产物去除构建时间戳后，内容与旧Sass链路逐份匹配；此对照不能替代所有浏览器样式回归。

9项自动测试通过，包含缓存版本变化、tsconfig extends、CSS变量/tilde别名、懒middleware请求激活与热更新代理产物。HTTP/WebSocket/Chrome smoke 已补充懒页面首次点击和DOM热更新断言，但本机自动审批服务仍因 `codex-auto-review` 模型不存在而阻止执行，尚未验证真实浏览器。

运行方式和回退开关见 README。复现组合实验：`node scripts/benchmark-compile.cjs optimized`，执行两次分别观察首次和重启；完整 eager 图可用 `optimized-eager`，旧Sass对照用 `optimized-project-sass`。原始数据新增于 `docs/performance-results/optimizedCold.json`、`optimizedWarm.json`。

## 实测结果

| 方案 | 启动编译阶段 | 六次单组件编辑的增量编译中位数 | 重建模块数 |
| --- | ---: | ---: | ---: |
| 当前默认：cache=false | 14.14 s | 13.25 s | 14,793 |
| 仅 cache=true | 14.00 s；复跑 13.12 s | 183.5 ms；复跑 178 ms | 13 |
| 内存缓存 + eval-cheap-module-source-map | 13.38 s | 163 ms | 13 |
| 内存缓存 + Babel cacheCompression=false | 缓存首次重建 16.62 s；复跑 13.67 s | 183.5 ms；复跑 185 ms | 13 |
| 持久缓存首次写入 | 13.53 s | 191.5 ms | 11 |
| 持久缓存第二次进程启动 | 4.44 s | 190 ms | 11 |
| 内存缓存 + 动态 import 懒编译（middleware 已接入） | 5.48 s | 110.5 ms | 13 |

冷启动一栏中的“首次”只指 Rspack compiler 生命周期，不代表清除了操作系统文件缓存或 Babel 缓存。首次编译每方案只测一轮，内存缓存与 Babel 不压缩另做一次复跑；小幅差异不能认定为稳定收益。持久缓存第二轮只需实际重建 1,451 个模块，包含 1,371 个 Sass 模块；没有达到完全复用。

内存缓存是数量级差异：一次独立 Vue probe 的模板、script 或 style 编辑，编译阶段从 12.7–14.3 s 降到 0.17–0.20 s，约快 70 倍。对应 hot-update JS 从约 1.6 MB 降到 36.7–38.6 KB。该结果证明当前关闭缓存造成大量重复构建；不能据此承诺任意业务页面或共享依赖修改都能在 200 ms 内完成。

## 测量方式与边界

- 使用原项目完整入口和原有适配规则，额外加入 runner 自己的 Vue+TS+SCSS probe，与完整业务依赖图一起编译；首次共 14,793 个模块，其中 3,196 个经过 tsrs、4,244 个经过 Babel、1,808 个经过 Sass。各 loader 计数有交集，不是互斥耗时分解。
- 三类编辑各做两次：只改 probe 的 template 字面值、TS script 数值、SCSS 样式值。目标项目内容保持不变。共享全局 SCSS、通用组件、路由依赖变化可能导致更大重建范围，尚未测量。
- 每个方案独立 Node 进程、顺序执行，使用 memfs 输出，近似 dev middleware 的内存产物。持久缓存是同一配置的两次进程启动；两次仍会生成不同构建时间戳。
- 使用公开 `Watching.invalidateWithChangesAndRemovals()` 手动通知，不监听真实文件系统，不监听端口；验证编译无错且产生 hot-update 资源。排除了文件保存/OS watcher/网络/WebSocket/浏览器应用更新的时间。
- 表格均使用 `stats.endTime - stats.startTime`。第二次内存缓存测量到 invalidate→watch callback 为 181–201 ms，接近编译时间。原始数据中的 `wallMs` 还包含调查脚本枚举全部资产的约 0.4 秒开销，**不作为用户 HMR 时延**；`callbackMs` 不包含这段统计。
- eval、懒编译及持久缓存只证明编译可行；没有做浏览器交互、样式或跨配置缓存失效回归。不能把多个方案的百分比相加。

## 建议优先级

### 1. 恢复内存缓存：热更新的第一优先级

runner 显式 `config.cache=false`，在已安装 1.7.12 中还会强制 `experiments.cache=false`。先改为 `cache:true`，保留现有增量默认值。上述单变量实验已显示重建范围从全站降到 13 个模块。代价是保留模块缓存占用内存；需要继续验证共享 TS/SCSS、增删组件和自动导入更新。

### 2. 持久缓存：优化重启

使用 `experiments.cache:{type:'persistent',storage:{type:'filesystem',directory:runnerCachePath}}`，同时确保 `cache:true`。实验缓存约 957 MB，仅供量级参考，实际随代码和失效变化。正式实现需覆盖 adapter/tsrs-loader、目标配置、extends 配置、Babel/PostCSS/Sass 配置、lockfile 和编译选项的失效关系，不能直接照搬研究脚本简化的 buildDependencies。

原项目每次配置读取生成构建时间戳，进入 Define/Banner；Sass 又有全局注入依赖，这些是进一步分析持久缓存失效的方向。可先对照日志和模块原因，再决定是否稳定开发时间戳；稳定时间戳会改变页面构建信息语义。

### 3. 路由懒编译：大幅降低启动工作量，但转移等待

限制 `{entries:false,imports:true}`，最好只覆盖业务路由。实测首次编译模块从 14,793 降到 7,004，Sass 模块从 1,808 降到 513，启动编译从约 14 s 降到 5.5 s。

版本关键点：仅设置 `config.lazyCompilation` 在本离线调用中没有作用；需要调用 `lazyCompilationMiddleware(compiler)`，该函数同时安装插件并返回 HTTP middleware。当前 Dev Server 1.2.1 未发现自动接入这一步的代码，runner 需显式挂载并保持 proxy/history 顺序。研究脚本调用函数激活插件但未运行 HTTP 服务，**未验证首个路由请求**。成本会移动到用户首次访问该动态模块时，浏览器路由与 HMR 验证后才适合启用。

### 4. source map 模式：较小收益

eval-cheap-module-source-map 的本轮增量中位数比 memory baseline 少约 15–20 ms，低于缓存收益且存在测量波动；初始资产（包含 map）约从 151 MB 增到 199 MB。需满足 CSP/eval 条件并检查 Chrome 断点。关闭 source map 会牺牲调试，不建议直接作为默认。

### 5. Sass：下一轮首次编译优化重点

1,808 个 Sass 模块值得做 loader profiling；不能只看计数断言耗时比例。可在 runner 安装兼容的 sass-embedded 与新版 sass-loader，尝试复用 modern compiler。保留原主题与变量导入，先做 CSS 内容/顺序对比。

本轮把现有 sass-loader 13.3.3 改成 `api:'modern'` 的实验失败：无法解析 `@use "~@vab/styles/variables/variables.module.scss"`，涉及大量 Vue 样式，不能作为现成开关；旧版也不支持 `modern-compiler`。另可调查 Element Plus 自动导入同时走 Sass/CSS 的情况，但改成预编译 CSS 必须验证主题、暗色与覆盖样式，不能承诺无损。

### 6. 暂不优先的方向

- Babel 缓存压缩：JS 规则已有 false，TS/TSX 缺失；补齐后未测出稳定收益，重建缓存首轮反而更慢。可顺手规范，不应作为主要性能承诺。
- 增量参数：当前版本默认已开启多数 pass，单独 `incremental:true` 不代表新增优化。
- 自动导入扫描：已关闭声明生成，Components 仅扫描 36 个 Vue 文件且有搜索守卫，优先级低于缓存和 Sass。
- 移除 Babel/SWC 替换：有 JSX、polyfill、插件行为及浏览器目标风险；需要保留 tsrs 作为 TS 转译器并单独证明等价，不建议先做。
- 降低 watcher debounce：已安装 Rspack 默认 aggregateTimeout 为 5 ms，不能套用“默认 200/300 ms”的其他版本建议；先定位真实保存→invalid→done→浏览器 apply 的时间，再调整。

## 复现

```sh
node scripts/benchmark-compile.cjs baseline
node scripts/benchmark-compile.cjs memory
node scripts/benchmark-compile.cjs eval
node scripts/benchmark-compile.cjs no-compression
node scripts/benchmark-compile.cjs persistent
node scripts/benchmark-compile.cjs persistent
node scripts/benchmark-compile.cjs lazy
```

这些命令会读取兄弟项目，写 runner 的 `.cache`，不修改兄弟项目。脚本用于研究而非默认配置；Babel 缓存命中状态和机器其他负载会影响结果。原始摘要保存于 `docs/performance-results/*.json`。源码与官方来源见 [performance-sources.md](performance-sources.md)。
