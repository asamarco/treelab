import { test, expect, type Page } from '@playwright/test';

// Helper function to log in
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username or Email').fill('testuser');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for the main page to load by checking for a known element
  await expect(page.getByRole('heading', { name: 'My First Tree' })).toBeVisible();
}

test.describe('Tree Operations', () => {
    
  test.beforeEach(async ({ page }) => {
    // Before each test, we need to create a default user if one doesn't exist.
    // We'll use the API route for this to ensure a clean state.
    // For this example, we'll assume a user 'testuser' with password 'password123'
    // can be created or exists. In a real app, this would be a proper API call.
    // Since we don't have an API for user creation, we'll just log in.
    // Note: The first user created is automatically an admin. Let's assume that's done.
    
    // Create a dummy user to ensure login is possible
    await page.goto('/register');
    // Check if we are on the register page or redirected
    if (page.url().includes('/register')) {
        const usernameInput = page.getByLabel('Username');
        if (await usernameInput.isVisible()) {
            await usernameInput.fill('testuser');
            await page.getByLabel('Password').fill('password123');
            await page.getByRole('button', { name: 'Create an account' }).click();
            await page.waitForURL('/'); // Wait to be redirected to home after registration
        } else {
            // Registration is likely disabled, or we were redirected. Assume user exists.
        }
    }
  });

  test('should allow a user to add a child node', async ({ page }) => {
    await login(page);

    // 1. Find the parent node and open its menu
    const parentNodeText = 'Q3 Product Launch';
    const parentNode = page.locator('.card-content', { hasText: parentNodeText }).first();
    await parentNode.hover();
    await parentNode.getByRole('button', { name: 'More options' }).click();
    
    // 2. Click "Add Child"
    await page.getByRole('menuitem', { name: 'Add Child' }).click();
    
    // 3. Select a template in the dialog
    await expect(page.getByRole('dialog', { name: 'Add New Node to "Q3 Product Launch"' })).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Task' }).click();

    // 4. Fill in the new node form
    const newChildName = `Automated Test Child - ${Date.now()}`;
    await page.getByLabel('Task Title').fill(newChildName);
    await page.getByLabel('Assignee').fill('Test Bot');
    await page.getByLabel('Description').fill('This is a test description.');

    // 5. Save the new node
    await page.getByRole('button', { name: 'Save' }).click();

    // 6. Assert that the new node is now visible in the tree
    // We check if the parent is expanded and the child is visible within it.
    const newChildNode = page.locator('.card-content', { hasText: newChildName });
    await expect(newChildNode).toBeVisible();

    // Verify it's a child of the correct parent
    const parentWithChild = page.locator('.card-content', { hasText: parentNodeText })
                                .locator('..') // go up to the container of the card
                                .locator('.collapsible-content') // find the children container
                                .locator('.card-content', { hasText: newChildName });
    
    await expect(parentWithChild).toBeVisible();
  });
});
