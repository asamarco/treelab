import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('should allow a user to sign up, sign out, and sign back in', async ({ page }) => {
    // Unique username for each test run to avoid conflicts
    const username = `testuser_${Date.now()}`;
    const password = 'password123';

    // --- 1. Sign Up ---
    await page.goto('/register');
    await expect(page).toHaveTitle(/Treelab/);

    // Ensure registration form is available before filling
    const usernameInput = page.getByLabel('Username');
    await expect(usernameInput).toBeVisible();
    
    await usernameInput.fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create an account' }).click();

    // After signup, user should be logged in and redirected to the main page.
    // We expect the welcome guide tree to be loaded.
    await expect(page.getByRole('heading', { name: 'Welcome to Treelab!' })).toBeVisible();

    // --- 2. Sign Out ---
    // Open user menu
    const userAvatarButton = page.locator('button > .avatar');
    await userAvatarButton.click();
    
    // Click logout
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    
    // User should be redirected to the login page
    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await expect(page).toHaveURL(/.*login/);

    // --- 3. Sign In ---
    await page.getByLabel('Username or Email').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // User should be logged in again and see the main page
    await expect(page.getByRole('heading', { name: 'Welcome to Treelab!' })).toBeVisible();
    
    // Check that the user menu is present again
    await expect(userAvatarButton).toBeVisible();
  });
});
