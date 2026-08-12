import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

const WORKSPACE_READY_TIMEOUT_MS = 45_000;

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

  test('serves the normalized Aethor_robo dual-arm URDF and all model meshes', async ({ request }) => {
    const assetRoot = '/robot-profiles/aethor-robo-dual-7dof';
    const meshPaths = [
      'meshes/satellite_base_link.stl',
      'meshes/left_arm_base_link.stl',
      'meshes/right_arm_base_link.stl',
      ...Array.from({ length: 7 }, (_, index) => `meshes/left_arm_link_${index + 1}.stl`),
      ...Array.from({ length: 7 }, (_, index) => `meshes/right_arm_link_${index + 1}.stl`),
      ...Array.from({ length: 6 }, (_, index) => `meshes/wheel_link_${index + 1}.stl`)
    ];
    for (const assetPath of ['model/aethor_robo.urdf', ...meshPaths]) {
      const response = await request.get(`${assetRoot}/${assetPath}`);
      expect(response.ok(), assetPath).toBe(true);
      expect((await response.body()).byteLength, assetPath).toBeGreaterThan(0);
    }

    const urdf = await request.get(`${assetRoot}/model/aethor_robo.urdf`);
    const urdfText = await urdf.text();
    expect(urdfText).toContain('name="aethor_robo"');
    expect(urdfText).toContain('name="left_arm_joint_7"');
    expect(urdfText).toContain('name="right_arm_joint_7"');
  });

  test('parses every Aethor_robo STL once and shares immutable geometry across visual and collision nodes', async ({ page }) => {
    const meshRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/robot-profiles/aethor-robo-dual-7dof/meshes/') && url.endsWith('.stl')) {
        meshRequests.push(url);
      }
    });

    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    expect(meshRequests).toHaveLength(23);
    expect(new Set(meshRequests).size).toBe(23);

    const diagnostics = page.getByRole('dialog', { name: '模型诊断' });
    await page.getByRole('button', { name: '诊断' }).click();
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics.locator('dt', { hasText: 'GEOMETRY / MATERIAL' }).locator('..').locator('dd'))
      .toHaveText('29 / 22');
  });

  test('switches the complete workspace context between Aethor_robo and Dummy', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const selector = page.getByRole('combobox', { name: '当前机器人配置' });
    await expect(selector).toContainText('Aethor_robo');

    await selectRobotProfile(page, 'Dummy');
    await expect(page.getByText('Dummy · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.locator('.sidebarFooter')).toContainText('Dummy');
    await expect(page.getByText('FRONTEND SHOWCASE', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Target preview', { exact: true })).toHaveCount(0);
    await expect(page.locator('.recentEvents .eventRow small')).toHaveCount(0);
    await expect(page.locator('.serialSessionControl select')).toBeDisabled();
    await expect(page.locator('.serialSessionControl select')).toHaveValue('');
    await page.getByLabel('J1 目标角度数值').fill('25');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="target"]')).toHaveText('25.00');

    await selectRobotProfile(page, 'Aethor_robo');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await page.goto('/terminal');
    await expect(page.getByRole('heading', { name: /串口终端尚未支持 Aethor_robo/ })).toBeVisible();
    await page.getByRole('button', { name: '切换到 Dummy' }).click();
    await expect(page.getByText('STATIC PROTOCOL CAPTURE')).toBeVisible();

    await page.goto('/console');
    await expect(page.getByText('Dummy · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.getByLabel('J1 目标角度数值')).not.toHaveValue('25');
  });

  test('keeps hardware safety state explicit across all routes', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await useProfileOnLoad(page, 'dummy-6dof');
    for (const [path, title] of [['/console', '控制台'], ['/scope', '数据示波'], ['/terminal', '串口终端'], ['/devices', '设备与模型'], ['/actions', '动作编排']] as const) {
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

    expect(typography.title).toBeGreaterThanOrEqual(23);
    expect(typography.navigation).toBeGreaterThanOrEqual(14);
    expect(typography.chrome).toBeGreaterThanOrEqual(14);

    await page.goto('/devices');
    await expect(page.getByText('#CMDMODE 1–3 · 电机去使能后可切换')).toBeVisible();
    await expect(page.locator('.modeControl button')).toHaveCount(3);
    expect(consoleErrors).toEqual([]);
  });

  test('does not enumerate or connect serial when the gateway is not configured', async ({ page }) => {
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });
    await useProfileOnLoad(page, 'dummy-6dof');
    await page.goto('/devices');

    await expect(page.getByText('BACKEND ABSENT')).toBeVisible();
    await expect(page.locator('.serialSessionControl select')).toBeDisabled();
    await expect(page.locator('.serialConnectRow select')).toBeDisabled();
    await expect(page.getByRole('button', { name: /连接设备/ })).toBeDisabled();
    await expect(page.getByText('UNAVAILABLE', { exact: true }).first()).toBeVisible();
    expect(hardwareRequests).toEqual([]);
  });

  test('validates a managed profile package locally without installing or contacting hardware', async ({ page }) => {
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });
    await useProfileOnLoad(page, 'dummy-6dof');
    await page.goto('/devices');
    const manifestText = await readFile(new URL(
      '../../../../shared/robot-profiles/BuiltIn/dummy-6dof/manifest.json',
      import.meta.url
    ), 'utf8');
    const manifest = JSON.parse(manifestText) as { joints: Array<{ urdfJointName: string }> };
    const urdf = `<robot name="dummy"><link name="base_link"><visual><geometry><mesh filename="../meshes/base.stl"/></geometry></visual></link>${manifest.joints.map((joint, index) => `<link name="link_${index + 1}"/><joint name="${joint.urdfJointName}" type="revolute"><parent link="base_link"/><child link="link_${index + 1}"/></joint>`).join('')}</robot>`;
    const archive = zipSync({
      'manifest.json': strToU8(manifestText),
      'model/dummy.urdf': strToU8(urdf),
      'meshes/base.stl': strToU8('solid base\nendsolid base'),
      'NOTICE.md': strToU8('BSD-3-Clause')
    });

    await page.locator('.packageDropzone input[type="file"]').setInputFiles({
      name: 'dummy-preview.aethor-robot',
      mimeType: 'application/zip',
      buffer: Buffer.from(archive)
    });

    await expect(page.getByText('PACKAGE STRUCTURE VALID', { exact: true })).toBeVisible();
    await expect(page.getByText(/STL PATHS ONLY/)).toBeVisible();
    await expect(page.getByText('NOT IMPLEMENTED', { exact: true })).toBeVisible();
    expect(hardwareRequests).toEqual([]);
  });

  test('separates target preview from feedback and disables hardware submission', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.getByTestId('scene-fallback')).toHaveCount(0);
    const actualBefore = await page.locator('tr[data-joint-id="j1"] td[data-column="actual"]').textContent();
    const target = page.getByLabel('L-J1 目标角度数值');
    await target.fill('25');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="target"]')).toHaveText('25.00');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="actual"]')).toHaveText(actualBefore ?? '');
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
    await expect(page.getByText('MODEL PREVIEW ONLY', { exact: false }).first()).toBeVisible();
  });

  test('fits the camera to loaded robot bounds and reapplies the fit on reset', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const scene = page.locator('.robotSceneHost');
    await expect(scene).toHaveAttribute('data-camera-fit', 'ready');
    await expect(scene).toHaveAttribute('data-camera-reset-signal', '0');
    await expect(scene).toHaveAttribute('data-reference-grid', 'ready');

    const initialDistance = Number(await scene.getAttribute('data-camera-fit-distance'));
    const initialBoundsRevision = Number(await scene.getAttribute('data-camera-bounds-revision'));
    const referenceGridY = Number(await scene.getAttribute('data-reference-grid-y'));
    const modelMinY = Number(await scene.getAttribute('data-model-min-y'));
    const referenceGridSize = Number(await scene.getAttribute('data-reference-grid-size'));
    const modelFootprint = Number(await scene.getAttribute('data-model-footprint'));
    expect(initialDistance).toBeGreaterThan(0);
    expect(initialBoundsRevision).toBeGreaterThan(0);
    expect(referenceGridY).toBeLessThan(modelMinY);
    expect(modelMinY - referenceGridY).toBeGreaterThanOrEqual(0.08);
    expect(referenceGridSize).toBeGreaterThanOrEqual(modelFootprint * 2);
    expect(referenceGridSize).toBeGreaterThanOrEqual(6);

    await page.getByLabel('L-J1 目标角度数值').fill('25');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="target"]')).toHaveText('25.00');
    await page.waitForTimeout(100);
    expect(Number(await scene.getAttribute('data-camera-bounds-revision'))).toBe(initialBoundsRevision);

    await page.getByRole('button', { name: '重置相机', exact: true }).click();

    await expect(scene).toHaveAttribute('data-camera-reset-signal', '1');
    await expect.poll(async () => Number(await scene.getAttribute('data-camera-bounds-revision')))
      .toBeGreaterThan(initialBoundsRevision);
    expect(Number(await scene.getAttribute('data-camera-fit-distance'))).toBeGreaterThan(0);
  });

  test('suspends idle 3D rendering and resumes it for joint preview changes', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const scene = page.locator('.robotSceneHost');
    await expect(scene).toHaveAttribute('data-render-policy', 'demand');
    await expect.poll(async () => Number(await scene.getAttribute('data-render-dpr'))).toBeGreaterThanOrEqual(1);
    const renderDpr = Number(await scene.getAttribute('data-render-dpr'));
    const sceneBounds = await scene.boundingBox();
    expect(renderDpr).toBeLessThanOrEqual(1.75);
    expect(sceneBounds).not.toBeNull();
    expect(sceneBounds!.width * sceneBounds!.height * renderDpr * renderDpr).toBeLessThanOrEqual(3_505_000);
    await expect.poll(async () => Number(await scene.getAttribute('data-render-frame-count'))).toBeGreaterThan(1);

    await page.waitForTimeout(500);
    const idleStart = Number(await scene.getAttribute('data-render-frame-count'));
    await page.waitForTimeout(500);
    const idleEnd = Number(await scene.getAttribute('data-render-frame-count'));
    expect(idleEnd - idleStart).toBeLessThanOrEqual(1);

    await page.getByLabel('L-J1 目标角度数值').fill('12.5');
    await expect.poll(async () => Number(await scene.getAttribute('data-render-frame-count')))
      .toBeGreaterThan(idleEnd);
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="target"]')).toHaveText('12.50');

    await page.waitForTimeout(300);
    const secondIdleStart = Number(await scene.getAttribute('data-render-frame-count'));
    await page.waitForTimeout(400);
    const secondIdleEnd = Number(await scene.getAttribute('data-render-frame-count'));
    expect(secondIdleEnd - secondIdleStart).toBeLessThanOrEqual(1);
  });

  test('focuses either seven-axis arm locally and restores the full spacecraft view', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const scene = page.locator('.robotSceneHost');
    await expect(scene).toHaveAttribute('data-camera-fit', 'ready');
    const fullDistance = Number(await scene.getAttribute('data-camera-fit-distance'));
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });
    const focusControls = page.getByRole('group', { name: '相机取景' });

    await focusControls.getByRole('button', { name: '右臂' }).click();
    await expect(scene).toHaveAttribute('data-camera-focus', 'right-arm');
    await expect.poll(async () => Number(await scene.getAttribute('data-camera-fit-distance')))
      .toBeLessThan(fullDistance * 0.75);
    await expect(page.getByRole('button', { name: '右臂 · 7轴' })).toHaveAttribute('aria-pressed', 'true');

    await focusControls.getByRole('button', { name: '左臂' }).click();
    await expect(scene).toHaveAttribute('data-camera-focus', 'left-arm');
    await expect(page.getByRole('button', { name: '左臂 · 7轴' })).toHaveAttribute('aria-pressed', 'true');

    await focusControls.getByRole('button', { name: '整机' }).click();
    await expect(scene).toHaveAttribute('data-camera-focus', 'all');
    await expect.poll(async () => Number(await scene.getAttribute('data-camera-fit-distance')))
      .toBeCloseTo(fullDistance, 4);
    expect(hardwareRequests).toEqual([]);
  });

  test('selects and nudges both seven-axis groups without creating a hardware transport path', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });

    for (const [tab, prefix] of [['左臂 · 7轴', 'L-J'], ['右臂 · 7轴', 'R-J']] as const) {
      await page.getByRole('button', { name: tab }).click();
      for (let index = 1; index <= 7; index += 1) {
        const jointName = `${prefix}${index}`;
        const selector = page.getByRole('button', { name: `选择 ${jointName} 关节` });
        const numericInput = page.getByLabel(`${jointName} 目标角度数值`);
        const before = Number(await numericInput.inputValue());
        await selector.focus();
        await selector.press('ArrowRight');
        await expect(selector).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByLabel(`${jointName} 关节微调`)).toContainText(`SELECTED · ${jointName}`);
        await expect(numericInput).toHaveValue(String(Number((before + 0.1).toFixed(2))));
      }
    }

    await page.getByLabel('R-J2 目标角度数值').fill('999');
    await expect(page.getByLabel('R-J2 目标角度数值')).toHaveValue('360');
    expect(hardwareRequests).toEqual([]);
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
  });

  test('releases renderer, controls and model ownership across repeated workspace mounts', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    for (let index = 0; index < 3; index += 1) {
      await page.locator('a[href="/devices"]').click();
      await expect(page.getByText('MODEL VALID', { exact: true })).toBeVisible();
      await page.locator('a[href="/console"]').click();
      await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    }
    const diagnostics = page.getByRole('dialog', { name: '模型诊断' });
    if (await diagnostics.count() === 0) await page.getByRole('button', { name: '诊断' }).click();
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics.locator('dt', { hasText: 'RENDERER / CONTROLS' }).locator('..').locator('dd')).toHaveText('1 / 1');
    await expect(diagnostics.locator('dt', { hasText: 'MODEL ROOTS' }).locator('..').locator('dd')).toHaveText('2');
    await expect(diagnostics.locator('dt', { hasText: 'GEOMETRY / MATERIAL' }).locator('..').locator('dd')).toHaveText('29 / 22');
    await expect(diagnostics.locator('dt', { hasText: 'DRAG SESSION' }).locator('..').locator('dd')).toHaveText('0');
  });

  test('drags the selected 3D joint preview without mutating feedback or sending hardware', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    const targetInput = page.getByLabel('L-J1 目标角度数值');
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
    await expect(page.getByRole('button', { name: '选择 L-J1 关节' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tr[data-joint-id="j1"] td[data-column="actual"]')).toHaveText(initialActual ?? '');
    expect(hardwareRequests).toEqual([]);
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
    const diagnostics = page.getByRole('dialog', { name: '模型诊断' });
    if (await diagnostics.count() === 0) await page.getByRole('button', { name: '诊断' }).click();
    await expect(diagnostics.locator('dt', { hasText: 'DRAG SESSION' }).locator('..').locator('dd')).toHaveText('0');
  });

  test('fails visibly and safely when the URDF resource cannot be loaded', async ({ page }) => {
    await page.route('**/robot-profiles/aethor-robo-dual-7dof/model/aethor_robo.urdf', (route) => route.abort('failed'));
    await page.goto('/console');
    await expect(page.getByText('URDF LOAD FAILED', { exact: true })).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.getByRole('alert')).toContainText('MODEL RESOURCE FAILED');
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
  });

  test('recovers one interrupted same-origin mesh request without hiding persistent failures', async ({ page }) => {
    let meshAttempts = 0;
    await page.route('**/robot-profiles/aethor-robo-dual-7dof/meshes/left_arm_link_3.stl', async (route) => {
      meshAttempts += 1;
      if (meshAttempts === 1) await route.abort('internetdisconnected');
      else await route.continue();
    });

    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    expect(meshAttempts).toBe(2);
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
  });

  test('terminal allows direct editing but keeps offline sending disabled', async ({ page }) => {
    await useProfileOnLoad(page, 'dummy-6dof');
    await page.goto('/terminal');
    const terminalRows = page.locator('.terminalLog .protocolRow');
    const hiddenPollRowCount = await terminalRows.count();
    const showJointPolling = page.getByRole('button', { name: '显示 GETJPOS' });
    await expect(showJointPolling).toBeVisible();
    await expect(page.locator('.terminalLog')).not.toContainText('#GETJPOS');
    await showJointPolling.click();
    await expect(page.getByRole('button', { name: '隐藏 GETJPOS' })).toBeVisible();
    await expect(page.locator('.terminalLog')).toContainText('#GETJPOS');
    expect(await terminalRows.count()).toBeGreaterThan(hiddenPollRowCount);
    await page.getByRole('button', { name: '隐藏 GETJPOS' }).click();
    await expect(page.locator('.terminalLog')).not.toContainText('#GETJPOS');
    await expect(page.getByLabel('Dummy ASCII 命令')).toBeEditable();
    await page.getByRole('button', { name: /#CMDMODE 3/ }).click();
    await expect(page.getByText('MODE · FORMAT VALID')).toBeVisible();
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
    await page.getByLabel('Dummy ASCII 命令').fill('#CMDMODE 5');
    await expect(page.getByText('INVALID', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
  });

  test('keeps the shell readable and within the viewport on every workspace', async ({ page }) => {
    const workspaces = [
      ['/console', '控制台', 'Aethor_robo · URDF READY'],
      ['/scope', '数据示波', 'LIVE UNAVAILABLE'],
      ['/terminal', '串口终端', 'STATIC PROTOCOL CAPTURE'],
      ['/devices', '设备与模型', 'PROFILE VALID'],
      ['/actions', '动作编排', 'NO EXECUTION PATH']
    ] as const;

    for (const [path, title, readyMarker] of workspaces) {
      await page.goto(path);
      if (path !== '/console' && await page.getByRole('heading', { name: new RegExp(`尚未支持 Aethor_robo$`) }).count()) {
        await page.getByRole('button', { name: '切换到 Dummy' }).click();
      }
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
        const readableSelectors = [
          { selector: '.navItem strong', minimum: 14 },
          { selector: '.statusMetric strong', minimum: 12.5 },
          { selector: '.sourceTag', minimum: 11 }
        ];
        const fontSizes = readableSelectors.flatMap(({ selector, minimum }) => {
          const element = document.querySelector<HTMLElement>(selector);
          return element ? [{ selector, minimum, size: Number.parseFloat(getComputedStyle(element).fontSize) }] : [];
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
      for (const font of layout.fontSizes) {
        expect(font.size, `${path} ${font.selector} is too small`).toBeGreaterThanOrEqual(font.minimum);
      }
    }
  });

  test('keeps critical console actions visible and disabled reasons focusable', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: '软件急停' })).toBeVisible();
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeVisible();
    const profile = page.getByRole('combobox', { name: '当前机器人配置' });
    await expect(profile).toContainText('Aethor_robo');
    await expect(profile).not.toContainText('DUAL 7-DOF');
    const profileTypography = await profile.locator('strong').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        title: element.getAttribute('title'),
        fontFamily: getComputedStyle(document.body).fontFamily
      };
    });
    expect(profileTypography).toMatchObject({
      overflow: 'hidden',
      textOverflow: 'clip',
      whiteSpace: 'nowrap',
      title: 'Aethor_robo',
      fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    });
    expect(profileTypography.scrollWidth).toBeLessThanOrEqual(profileTypography.clientWidth);
    await expect(page.locator('.serialSessionControl select')).toBeDisabled();
    await expect(page.getByRole('button', { name: '连接', exact: true })).toBeDisabled();

    const headerColumns = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing header column: ${selector}`);
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      };
      return {
        header: rect('.statusHeader'),
        profile: rect('.deviceSelector'),
        serial: rect('.serialSessionControl'),
        telemetry: rect('.headerTelemetry'),
        emergency: rect('.emergencyButton')
      };
    });
    expect(headerColumns.profile.right).toBeLessThanOrEqual(headerColumns.serial.left);
    expect(headerColumns.serial.right).toBeLessThanOrEqual(headerColumns.telemetry.left);
    expect(headerColumns.telemetry.right).toBeLessThanOrEqual(headerColumns.emergency.left);
    expect(headerColumns.serial.top).toBeGreaterThanOrEqual(headerColumns.header.top);
    expect(headerColumns.serial.bottom).toBeLessThanOrEqual(headerColumns.header.bottom);

    const overlayLayout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing console overlay: ${selector}`);
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
      };
      return {
        toolbar: rect('.sceneToolbar'),
        focus: rect('.sceneFocusTabs'),
        feedback: rect('.feedbackHud'),
        manipulator: rect('.jointManipulatorHud'),
        legend: rect('.sceneLegend'),
        loadState: rect('.modelLoadState')
      };
    });
    expect(overlayLayout.toolbar.bottom).toBeLessThanOrEqual(overlayLayout.focus.top);
    expect(overlayLayout.feedback.bottom).toBeLessThanOrEqual(overlayLayout.manipulator.top);
    expect(overlayLayout.legend.right).toBeLessThanOrEqual(overlayLayout.loadState.left);

    const headerMetrics = await page.locator('.statusMetric').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const value = element.querySelector('strong');
      return {
        left: bounds.left,
        right: bounds.right,
        text: value?.textContent,
        valueClientWidth: value?.clientWidth ?? 0,
        valueScrollWidth: value?.scrollWidth ?? 0
      };
    }));
    expect(headerMetrics.map((metric) => metric.text)).toEqual(['N/A', 'NO DATA', 'N/A']);
    headerMetrics.forEach((metric, index) => {
      expect(metric.valueScrollWidth, `status value ${metric.text} should remain inside its column`)
        .toBeLessThanOrEqual(metric.valueClientWidth);
      if (index > 0) expect(headerMetrics[index - 1]!.right).toBeLessThanOrEqual(metric.left);
    });

    const controlPanelLayout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.jointControlPanel');
      const rows = document.querySelector<HTMLElement>('.jointRows');
      const notice = document.querySelector<HTMLElement>('.previewNotice');
      const send = document.querySelector<HTMLElement>('.sendGroupButton');
      if (!panel || !rows || !notice || !send) throw new Error('Console control panel structure is incomplete');
      const panelRect = panel.getBoundingClientRect();
      const rowsRect = rows.getBoundingClientRect();
      const noticeRect = notice.getBoundingClientRect();
      const sendRect = send.getBoundingClientRect();
      return {
        rowsBottom: rowsRect.bottom,
        noticeTop: noticeRect.top,
        noticeBottom: noticeRect.bottom,
        sendBottom: sendRect.bottom,
        panelBottom: panelRect.bottom,
        rowsScrollHeight: rows.scrollHeight,
        rowsClientHeight: rows.clientHeight
      };
    });
    expect(controlPanelLayout.rowsBottom).toBeLessThanOrEqual(controlPanelLayout.noticeTop + 0.5);
    expect(controlPanelLayout.noticeBottom).toBeLessThanOrEqual(controlPanelLayout.sendBottom);
    expect(controlPanelLayout.sendBottom).toBeLessThanOrEqual(controlPanelLayout.panelBottom + 0.5);
    expect(controlPanelLayout.rowsScrollHeight).toBeGreaterThanOrEqual(controlPanelLayout.rowsClientHeight);

    const finalLeftJoint = page.getByRole('button', { name: '选择 L-J7 关节' });
    await finalLeftJoint.scrollIntoViewIfNeeded();
    await expect(finalLeftJoint).toBeVisible();

    const reason = page.getByLabel('Aethor_robo 固件和协议尚未完成，控制台没有任何硬件发送路径。');
    await expect(reason).toHaveCount(1);
    await reason.focus();
    await expect(reason).toBeFocused();
    await expect(page.getByRole('button', { name: '软件急停' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '网关未连接 · 禁止下发' })).toBeDisabled();
  });

  test('edits and explicitly saves an offline action document without hardware traffic', async ({ page }) => {
    const hardwareRequests: string[] = [];
    page.on('request', (request) => {
      if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) hardwareRequests.push(request.url());
    });
    await useProfileOnLoad(page, 'dummy-6dof');
    await page.goto('/actions');
    await page.getByRole('button', { name: '新建空白程序' }).click();
    await page.getByLabel('动作程序名称').fill('E2E inspection cycle');
    await page.getByRole('button', { name: '添加目标草稿' }).click();
    await page.getByLabel('J1 点位角度').fill('20');
    await page.getByRole('button', { name: '加载到 Dummy 本地目标草稿' }).click();

    await expect(page.getByText('TARGET PREVIEW · NO SEND')).toBeVisible();
    await expect(page.getByRole('button', { name: /运行程序/ })).toBeDisabled();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('SAVED REVISION')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: /^E2E inspection cycle/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /运行程序/ })).toBeDisabled();
    expect(hardwareRequests).toEqual([]);
  });

  test('matches the reviewed console shell baseline', async ({ page }) => {
    await page.goto('/console');
    await expect(page.getByText('Aethor_robo · URDF READY')).toBeVisible({ timeout: WORKSPACE_READY_TIMEOUT_MS });
    await expect(page).toHaveScreenshot('console-shell.png', {
      animations: 'disabled'
    });
  });
});

async function useProfileOnLoad(page: Page, profileId: 'dummy-6dof' | 'aethor-robo-dual-7dof') {
  await page.addInitScript(([key, value]) => window.sessionStorage.setItem(key, value), [
    'aethor.active-profile.v1',
    profileId
  ] as const);
}

async function selectRobotProfile(page: Page, displayName: 'Dummy' | 'Aethor_robo') {
  const selector = page.getByRole('combobox', { name: '当前机器人配置' });
  await selector.click();
  await page.getByRole('option', { name: new RegExp(`^${displayName}`) }).click();
  await expect(selector).toContainText(displayName);
}
