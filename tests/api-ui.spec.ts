import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('API UI Enablement in Settings', () => {
  let originalConfigContent: string;
  let configPath: string;

  test.beforeAll(() => {
    const envPath = path.join(process.cwd(), '.env');
    const txtPath = path.join(process.cwd(), 'config.txt');
    const jsonPath = path.join(process.cwd(), 'config.json');
    configPath = fs.existsSync(envPath) ? envPath : fs.existsSync(txtPath) ? txtPath : jsonPath;
    originalConfigContent = fs.readFileSync(configPath, 'utf8');
  });

  test.afterAll(() => {
    fs.writeFileSync(configPath, originalConfigContent, 'utf8');
  });

  test('should hide or show PAT key management in settings page based on configuration', async ({ page }) => {
    // 1. Register a user
    const username = `apiui_${Date.now()}`;
    const password = 'password123';
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page).toHaveURL('/');

    // 2. Set API to disabled
    if (configPath.endsWith('.env') || configPath.endsWith('.txt')) {
      fs.writeFileSync(configPath, originalConfigContent.replace(/ENABLE_API=true/g, 'ENABLE_API=false'), 'utf8');
    } else {
      const configObj = JSON.parse(originalConfigContent);
      configObj.ENABLE_API = false;
      fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');
    }

    // Go to settings and check that Personal Access Tokens card is not visible
    await page.goto('/settings');
    await expect(page.locator('text=Personal Access Tokens')).not.toBeVisible();

    // 3. Set API to enabled
    fs.writeFileSync(configPath, originalConfigContent, 'utf8');

    // Reload settings page and check that Personal Access Tokens card is visible
    await page.goto('/settings');
    await expect(page.locator('text=Personal Access Tokens').first()).toBeVisible();
  });
});
