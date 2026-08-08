import { expect, test } from '@playwright/test';

const WORKSPACE_READY_TIMEOUT_MS = 30_000;

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
    await expect(page.locator('.sidebarBrandLockup')).toHaveAccessibleName('Aethor Studio V2');
    await expect(page.locator('.wordmarkVersion')).toHaveText('V2');
    await expect(page.getByText('ROBOTICS ENGINEERING', { exact: false })).toHaveCount(0);
    await expect(page.getByText('CONTROL WORKSPACE', { exact: false })).toHaveCount(0);

    const typography = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('.pageIdentity h1');
      const navigation = document.querySelector<HTMLElement>('.navItem strong');
      const chrome = document.querySelector<HTMLElement>('.desktopChromeIdentity');
      if (!title || !navigation || !chrome) throw new Error('Shell typography elements are missing');
      return {
        title: Number.parseFloat(getComputedStyle(title).fontSize),
        navigation: Number.parseFloat(getComputedStyle(navigation).fontSize),
        chrome: Number.parseFloat(getComputedStyle(chrome).fontSize)
      };
    });

    expect(typography.title).toBeGreaterThanOrEqual(21);
    expect(typography.navigation).toBeGreaterThanOrEqual(14);
    expect(typography.chrome).toBeGreaterThanOrEqual(13);

    await page.goto('/devices');
    await expect(page.getByText('#CMDMODE 1–3 · PHASE 5')).toBeVisible();
    await expect(page.locator('.modeControl button')).toHaveCount(3);
    expect(consoleErrors).toEqual([]);
  });

  test('does not enumerate or connect serial when the read-only gateway is not configured', async ({ page }) => {
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });
    await page.goto('/devices');

    await expect(page.getByText('BACKEND ABSENT')).toBeVisible();
    await expect(page.getByLabel('串口')).toBeDisabled();
    await expect(page.getByRole('button', { name: /只读连接/ })).toBeDisabled();
    await expect(page.getByText('UNAVAILABLE', { exact: true }).first()).toBeVisible();
    expect(hardwareRequests).toEqual([]);
  });

  test('separates target preview from feedback and disables hardware submission', async ({ page }) => {
    await page.goto('/twin');
    await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const actualBefore = await page.locator('tr[data-joint-id="j1"] td[data-column="actual"]').textContent();
    const target = page.getByLabel('J1 目标角度数值');
    await target.fill('25');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="target"]')).toHaveText('25.00');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="actual"]')).toHaveText(actualBefore ?? '');
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
    await expect(page.getByText('SHOWCASE CAPTURE', { exact: true }).first()).toBeVisible();
  });

  test('selects and nudges all six joints without creating a hardware transport path', async ({ page }) => {
    await page.goto('/twin');
    await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });

    for (let index = 1; index <= 6; index += 1) {
      const selector = page.getByRole('button', { name: `选择 J${index} 关节` });
      const numericInput = page.getByLabel(`J${index} 目标角度数值`);
      const before = Number(await numericInput.inputValue());
      await selector.focus();
      await selector.press('ArrowRight');
      await expect(selector).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel(`J${index} 关节微调`)).toContainText(`SELECTED · J${index}`);
      await expect(numericInput).toHaveValue(String(Number((before + 0.1).toFixed(2))));
    }

    await page.getByLabel('J2 目标角度数值').fill('999');
    await expect(page.getByLabel('J2 目标角度数值')).toHaveValue('124.9');
    expect(hardwareRequests).toEqual([]);
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
  });

  test('releases renderer, controls and model ownership across repeated workspace mounts', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/twin');
    await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    for (let index = 0; index < 3; index += 1) {
      await page.locator('a[href="/scope"]').click();
      await expect(page.getByText('LIVE UNAVAILABLE', { exact: true })).toBeVisible();
      await page.locator('a[href="/twin"]').click();
      await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    }
    const diagnostics = page.getByRole('dialog', { name: '模型诊断' });
    if (await diagnostics.count() === 0) await page.getByRole('button', { name: '诊断' }).click();
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics.locator('dt', { hasText: 'RENDERER / CONTROLS' }).locator('..').locator('dd')).toHaveText('1 / 1');
    await expect(diagnostics.locator('dt', { hasText: 'MODEL ROOTS' }).locator('..').locator('dd')).toHaveText('2');
    await expect(diagnostics.locator('dt', { hasText: 'DRAG SESSION' }).locator('..').locator('dd')).toHaveText('0');
  });

  test('drags the selected 3D joint preview without mutating feedback or sending hardware', async ({ page }) => {
    await page.goto('/twin');
    await expect(page.getByText('URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const targetInput = page.getByLabel('J1 目标角度数值');
    const initialTarget = await targetInput.inputValue();
    const initialActual = await page.locator('tr[data-joint-id="j1"] td[data-column="actual"]').textContent();
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });
    const scene = page.locator('.robotSceneHost');
    await expect(scene).toHaveAttribute('data-manipulator-ready', 'true');
    const dragCoordinates = await scene.evaluate((element) => ({
      startX: Number((element as HTMLElement).dataset.manipulatorStartX),
      startY: Number((element as HTMLElement).dataset.manipulatorStartY),
      endX: Number((element as HTMLElement).dataset.manipulatorEndX),
      endY: Number((element as HTMLElement).dataset.manipulatorEndY)
    }));
    const sceneBox = await scene.boundingBox();
    expect(sceneBox).not.toBeNull();
    await page.mouse.move(sceneBox!.x + dragCoordinates.startX, sceneBox!.y + dragCoordinates.startY);
    await expect.poll(() => page.locator('body').evaluate((element) => element.style.cursor)).toBe('grab');
    await page.mouse.down();
    await expect(scene).toHaveAttribute('data-drag-state', 'active');
    await page.mouse.move(
      sceneBox!.x + dragCoordinates.endX,
      sceneBox!.y + dragCoordinates.endY,
      { steps: 8 }
    );
    await page.mouse.up();

    await expect.poll(() => targetInput.inputValue()).not.toBe(initialTarget);
    await expect(page.getByRole('button', { name: '选择 J1 关节' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="actual"]')).toHaveText(initialActual ?? '');
    expect(hardwareRequests).toEqual([]);
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
    const diagnostics = page.getByRole('dialog', { name: '模型诊断' });
    if (await diagnostics.count() === 0) await page.getByRole('button', { name: '诊断' }).click();
    await expect(diagnostics.locator('dt', { hasText: 'DRAG SESSION' }).locator('..').locator('dd')).toHaveText('0');
  });

  test('fails visibly and safely when the URDF resource cannot be loaded', async ({ page }) => {
    await page.route('**/robot-profiles/dummy-6dof/model/dummy.urdf', (route) => route.abort('failed'));
    await page.goto('/twin');
    await expect(page.getByText('URDF LOAD FAILED', { exact: true })).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.getByRole('alert')).toContainText('MODEL RESOURCE FAILED');
    await expect(page.getByRole('button', { name: '下发整组关节角' })).toBeDisabled();
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
