import { expect, test } from '@playwright/test';

const NAV = ['概览', '模型接入', '对话', '题库管理', '横向对比', '评测记录'] as const;
const HASHES: Record<string, string> = {
  概览: '#/dashboard',
  模型接入: '#/models',
  对话: '#/chat',
  题库管理: '#/questions',
  横向对比: '#/compare',
  评测记录: '#/runs',
};

test.describe('smoke：页面骨架与导航', () => {
  test('首页渲染品牌与默认路由', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.brand-name')).toHaveText('llmcompare');
    await expect(page.locator('.brand-sub')).toHaveText('大模型对比分析平台');
    await expect(page).toHaveURL(/#\/dashboard/);
  });

  for (const label of NAV) {
    test(`导航到「${label}」`, async ({ page }) => {
      await page.goto('/');
      await page.locator(`.sidebar .nav-item:has-text("${label}")`).click();
      await expect(page).toHaveURL(new RegExp(`${HASHES[label].replace('#/', '#/')}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  }

  test('hash 直达对应页面（SPA 回退）', async ({ page }) => {
    await page.goto('/#/questions');
    await expect(page.locator('.brand-name')).toBeVisible();
    await expect(page.getByText('通用能力示例题库').first()).toBeVisible();
  });
});

test.describe('smoke：模型接入', () => {
  test('接入新模型后列表可见且不回显密钥', async ({ page }) => {
    await page.goto('/#/models');
    await page.getByRole('button', { name: '接入模型' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 默认「内置模拟」协议：无需地址，填名称与密钥即可
    await dialog.getByPlaceholder('例如 DeepSeek Chat').fill('E2E 测试模型');
    await dialog.getByPlaceholder('sk-...').fill('sk-e2e-secret-123');
    await dialog.getByRole('button', { name: '接入', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('E2E 测试模型')).toBeVisible();
    // 明文密钥不得回显
    await expect(page.locator('body')).not.toContainText('sk-e2e-secret-123');
  });
});

test.describe('smoke：题库管理', () => {
  test('默认示例题库与题目可见', async ({ page }) => {
    await page.goto('/#/questions');
    await expect(page.getByText('通用能力示例题库').first()).toBeVisible();
  });
});

test.describe('smoke：API 冒烟', () => {
  test('GET /api/health 返回健康状态', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status ?? body.ok ?? 'ok').toBeTruthy();
  });

  test('未知接口返回 404 JSON 而非 HTML', async ({ request }) => {
    const res = await request.get('/api/definitely-not-exist');
    expect(res.status()).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});
