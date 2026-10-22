import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:8087'
const flowURL = `${baseURL}/bpm/flowStart/zcglDisposalFlow`

let browser
let context
let page

beforeAll(async () => {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
    || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    executablePath,
  })
  context = await browser.newContext({
    storageState: process.env.E2E_STORAGE_STATE || undefined,
  })
  page = await context.newPage()
  await page.goto(flowURL, { waitUntil: 'domcontentloaded' })
})

afterAll(async () => {
  await context?.close()
  await browser?.close()
})

describe('资产管理处置流程', () => {
  it('选择可处置资产后自动回填资产信息', async () => {
    await page.getByRole('button', { name: '处置资产选择' }).click()
    const dialog = page.getByRole('dialog', { name: '资产管理-可处置资产选择' })
    const assetRow = dialog.getByRole('row').filter({ hasText: '一级国企2-农用土地' })
    await assetRow.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: '确定' }).click()

    await expect(page.getByText('NYTDZC00003360', { exact: true })).toBeVisible()
    await expect(page.getByText('农用土地', { exact: true }).first()).toBeVisible()
  })

  it('填写完整处置申请并保留可提交状态', async () => {
    await page.getByRole('textbox', { name: '法定批文号' }).fill('TEST-APPROVAL-20261019')

    await page.getByRole('textbox', { name: '处置方式' }).click()
    await page.getByText('政策性腾退', { exact: true }).click()

    await page.getByRole('textbox', { name: '是否有资金流入' }).click()
    await page.getByText('是', { exact: true }).click()
    await page.getByRole('textbox', { name: '预计流入金额（元）' }).fill('1000')
    await page.getByRole('textbox', { name: '申请说明' }).fill('自动化测试：验证资产处置流程表单提交。')
    await page.getByRole('textbox', { name: '*政策说明' }).fill('自动化测试政策说明')

    await expect(page.getByRole('textbox', { name: '法定批文号' })).toHaveValue('TEST-APPROVAL-20261019')
    await expect(page.getByRole('textbox', { name: '处置方式' })).toHaveValue('政策性腾退')
    await expect(page.getByRole('textbox', { name: '是否有资金流入' })).toHaveValue('是')
    await expect(page.getByRole('textbox', { name: '预计流入金额（元）' })).toHaveValue('1000')
    await expect(page.getByRole('textbox', { name: '申请说明' })).toHaveValue('自动化测试：验证资产处置流程表单提交。')
    await expect(page.getByRole('textbox', { name: '*政策说明' })).toHaveValue('自动化测试政策说明')
    await expect(page.getByRole('button', { name: '启动' })).toBeEnabled()
  })

  it.skipIf(process.env.SUBMIT_FLOW !== 'true')('启动完整流程（显式设置 SUBMIT_FLOW=true）', async () => {
    await page.getByRole('button', { name: '启动' }).click()
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(/成功|启动/)
  })
})
