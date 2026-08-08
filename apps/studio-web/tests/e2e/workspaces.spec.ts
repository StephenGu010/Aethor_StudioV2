import { expect, test } from '@playwright/test';

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

    for (const [path, title] of [['/twin', '数字孪生'], ['/scope', '数据示波'], ['/terminal', '串口终端'], ['/devices', '设备与模型']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText('SERIAL OFFLINE', { exact: false }).first()).toBeVisible();
    }
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
    await page.getByLabel('Dummy ASCII 命令').fill('#CMDMODE 5');
    await expect(page.getByText('MODE · FORMAT VALID')).toBeVisible();
    await expect(page.getByRole('button', { name: '真实发送' })).toBeDisabled();
  });
});
