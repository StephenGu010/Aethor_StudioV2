import { expect, test } from '@playwright/test';

const WORKSPACE_READY_TIMEOUT_MS = 15_000;

test.describe('Aethor Studio V2 workspaces', () => {
  test('serves the normalized Dummy URDF and every referenced mesh', async ({ request }) => {
    const assetRoot = '/robot-profiles/dummy-6dof';
    const assetPaths = [
      'model/dummy.urdf',
      'meshes/base.stl',
      'meshes/link_1.stl',
      'meshes/link_2.stl',
      'meshes/link_3.stl',
      'meshes/link_4.stl',
      'meshes/link_5.stl',
      'meshes/link_6.stl'
    ];

    for (const assetPath of assetPaths) {
      const response = await request.get(`${assetRoot}/${assetPath}`);
      expect(response.ok(), `${assetPath} should be available in the production preview`).toBe(true);
    }

    const urdf = await request.get(`${assetRoot}/model/dummy.urdf`);
    const urdfText = await urdf.text();
    expect(urdfText).toContain('<robot');
    expect(urdfText).toContain('name="dummy"');
  });

  test('keeps hardware safety state explicit across all routes', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    for (const [path, title] of [['/twin', '数字孪生'], ['/scope', '数据示波'], ['/terminal', '串口终端'], ['/devices', '设备与模型'], ['/actions', '动作编排']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText('SERIAL OFFLINE', { exact: false }).first()).toBeVisible();
    }
    await page.goto('/devices');
    await expect(page.getByText('#CMDMODE 1–3 · PROFILE ALLOWED')).toBeVisible();
    await expect(page.locator('.modeControl button')).toHaveCount(3);
    expect(consoleErrors).toEqual([]);
  });

  test('separates target preview from feedback and disables hardware submission', async ({ page }) => {
    await page.goto('/twin');
    const target = page.getByLabel('J1 目标角度数值');
    await target.fill('25');
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
    await expect(page.getByText('SHOWCASE CAPTURE', { exact: true }).first()).toBeVisible();
  });

  test('terminal validates locally without creating a live send path', async ({ page }) => {
    await page.goto('/terminal');
    await expect(page.getByLabel('Dummy ASCII 命令')).toHaveAttribute('readonly', '');
    await page.getByRole('button', { name: /#CMDMODE 3/ }).click();
    await expect(page.getByText('MODE · FORMAT VALID')).toBeVisible();
    await expect(page.getByRole('button', { name: '真实发送' })).toBeDisabled();
    await page.getByRole('button', { name: '解锁专家输入' }).click();
    await page.getByRole('textbox', { name: /输入/ }).fill('UNLOCK');
    await page.getByRole('button', { name: '确认解锁' }).click();
    await page.getByLabel('Dummy ASCII 命令').fill('#CMDMODE 5');
    await expect(page.getByText('INVALID', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '真实发送' })).toBeDisabled();
  });

  test('keeps the shell readable and within the viewport on every workspace', async ({ page }) => {
    const workspaces = [
      ['/twin', '数字孪生', 'URDF READY'],
      ['/scope', '数据示波', 'LIVE UNAVAILABLE'],
      ['/terminal', '串口终端', 'STATIC PROTOCOL CAPTURE'],
      ['/devices', '设备与模型', 'PROFILE VALID'],
      ['/actions', '动作编排', 'PHASE 6 PLANNED']
    ] as const;

    for (const [path, title, readyMarker] of workspaces) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText(readyMarker, { exact: true })).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });

      const layout = await page.evaluate(() => {
        const criticalSelectors = ['.desktopChrome', '.sidebar', '.statusHeader', '.pageHost'];
        const criticalRects = criticalSelectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return { selector, missing: true };
          const rect = element.getBoundingClientRect();
          return {
            selector,
            missing: false,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          };
        });
        const readableSelectors = ['.navItem strong', '.statusMetric strong', '.sourceTag'];
        const fontSizes = readableSelectors.flatMap((selector) => {
          const element = document.querySelector<HTMLElement>(selector);
          return element ? [{ selector, size: Number.parseFloat(getComputedStyle(element).fontSize) }] : [];
        });
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          criticalRects,
          fontSizes
        };
      });

      expect(layout.documentSize.width).toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.documentSize.height).toBeLessThanOrEqual(layout.viewport.height);
      for (const rect of layout.criticalRects) {
        expect(rect.missing, `${path} ${rect.selector} should exist`).toBe(false);
        expect(rect.left, `${path} ${rect.selector} starts outside viewport`).toBeGreaterThanOrEqual(0);
        expect(rect.top, `${path} ${rect.selector} starts outside viewport`).toBeGreaterThanOrEqual(0);
        expect(rect.right, `${path} ${rect.selector} exceeds viewport width`).toBeLessThanOrEqual(layout.viewport.width + 0.5);
        expect(rect.bottom, `${path} ${rect.selector} exceeds viewport height`).toBeLessThanOrEqual(layout.viewport.height + 0.5);
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
      }
      for (const font of layout.fontSizes) expect(font.size, `${path} ${font.selector} is too small`).toBeGreaterThanOrEqual(10);
    }
  });

  test('keeps critical twin actions visible and disabled reasons focusable', async ({ page }) => {
    await page.goto('/twin');
    await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: '软件急停' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeVisible();

    const reason = page.getByLabel('后端未连接，无法确认设备停机。请使用物理急停。');
    await expect(reason).toHaveCount(1);
    await reason.focus();
    await expect(reason).toBeFocused();
    await expect(page.getByRole('button', { name: '软件急停' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
  });

  test('matches the reviewed twin shell baseline', async ({ page }) => {
    await page.goto('/twin');
    await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page).toHaveScreenshot('twin-shell.png', {
      animations: 'disabled'
    });
  });
});
