import { test, expect, type Page } from '@playwright/test';
import path from 'path';

// Helper function to log in and navigate to the roots page
async function loginAndGoToRoots(page: Page) {
  await page.goto('/login');
  
  const loginButton = page.getByRole('button', { name: 'Sign in' });
  if (await loginButton.isVisible()) {
    await page.getByLabel('Username or Email').fill('testuser');
    await page.getByLabel('Password').fill('password123');
    await loginButton.click();
  }
  
  await page.waitForURL('/roots');
  await expect(page.getByRole('heading', { name: 'Manage Roots' })).toBeVisible();
}

test.describe('JSON Import Flow', () => {

  test.beforeEach(async ({ page }) => {
    // Ensure the default user exists for login.
    await page.goto('/register');
    const usernameInput = page.getByLabel('Username');
    if (await usernameInput.isVisible()) {
        await usernameInput.fill('testuser');
        await page.getByLabel('Password').fill('password123');
        await page.getByRole('button', { name: 'Create an account' }).click();
        await page.waitForURL('/roots');
    } else {
        await page.goto('/roots');
    }
  });

  test('should correctly import the CMDB example from JSON', async ({ page }) => {
    await loginAndGoToRoots(page);

    // 1. Open the import dropdown
    await page.getByRole('button', { name: 'Import' }).click();

    // 2. Set up a listener for the file chooser and trigger it
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import from JSON' }).click();
    const fileChooser = await fileChooserPromise;

    // 3. Set the file to be imported
    const filePath = path.join(process.cwd(), 'public', 'examples', 'cmdb-example.json');
    await fileChooser.setFiles(filePath);

    // 4. Wait for the import to complete and the app to navigate to the new tree
    await page.waitForURL('/');
    await expect(page.getByRole('heading', { name: 'CMDB Example' })).toBeVisible();

    // 5. Assert that there is exactly one root node
    // The main tree view container has a direct child div for each root node.
    const treeViewContainer = page.locator('#tree-view-container');
    await expect(treeViewContainer.locator('> div')).toHaveCount(1);
    
    // 6. Assert that there are 7 nodes in total (1 root + 6 children/grandchildren)
    // We look for the cards that represent each node.
    await expect(page.locator('.card-content .collapsible-trigger')).toHaveCount(7);
  });
});
