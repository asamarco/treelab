import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('API UI Enablement in Settings', () => {
  let originalConfigContent: string;

  test.beforeAll(() => {
    const configPath = path.join(process.cwd(), 'config.json');
    originalConfigContent = fs.readFileSync(configPath, 'utf8');
  });

  test.afterAll(() => {
    const configPath = path.join(process.cwd(), 'config.json');
    fs.writeFileSync(configPath, originalConfigContent, 'utf8');
  });

  test('should hide or show PAT key management in settings page based on config.json', async ({ page }) => {
    // 1. Register a user
    const username = `apiui_${Date.now()}`;
    const password = 'password123';
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page).toHaveURL('/');

    const configPath = path.join(process.cwd(), 'config.json');
    const configObj = JSON.parse(originalConfigContent);

    // 2. Set API to disabled
    configObj.ENABLE_API = false;
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');

    // Go to settings and check that Personal Access Tokens card is not visible
    await page.goto('/settings');
    await expect(page.locator('text=Personal Access Tokens')).not.toBeVisible();

    // 3. Set API to enabled
    configObj.ENABLE_API = true;
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');

    // Reload settings page and check that Personal Access Tokens card is visible
    await page.goto('/settings');
    await expect(page.locator('text=Personal Access Tokens').first()).toBeVisible();
  });
});
