# Vitest 浏览器流程测试

这是一个由 Vitest 驱动、使用 Playwright 控制真实 Chromium 的端到端测试。它针对正在运行的 `assets-supervision-ui` 流程启动页，不依赖修改业务项目源码。

```sh
# 先启动业务页面（默认 http://localhost:8087）
npm run demo

# 当前浏览器已有登录态时，可提供 Playwright storage state
E2E_STORAGE_STATE=/绝对路径/storage-state.json npm run test:e2e
```

可选环境变量：

- `E2E_BASE_URL`：业务服务地址，默认 `http://localhost:8087`。
- `HEADLESS=false`：显示 Playwright Chromium。
- `SUBMIT_FLOW=true`：额外执行“启动”提交用例；默认只填写和断言，不产生流程提交副作用。
- `PLAYWRIGHT_EXECUTABLE_PATH`：指定浏览器可执行文件；macOS 默认使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。

页面实际验证的业务路径是：选择可处置资产后回填资产编码、资产类型和处置类型；填写法定批文号、处置方式、是否有资金流入、预计流入金额、申请说明和政策说明；最后确认“启动”按钮可用。
