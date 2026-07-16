import { test, expect, APIRequestContext, request as playwrightRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe.serial('REST API (v1)', () => {
  let apiContext: APIRequestContext;
  let patToken: string;
  let treeId: string;
  let templateId: string;
  let nodeId: string;
  let originalConfigContent: string;

  test.beforeAll(async ({ browser }) => {
    // Store original config and ensure API is disabled first
    const configPath = path.join(process.cwd(), 'config.json');
    originalConfigContent = fs.readFileSync(configPath, 'utf8');

    const configObj = JSON.parse(originalConfigContent);
    const apiWasEnabled = configObj.ENABLE_API;
    
    // Test that API is disabled and returns 404
    configObj.ENABLE_API = false;
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');

    const checkDisabledContext = await playwrightRequest.newContext({
      baseURL: 'http://localhost:9002',
    });
    const disabledRes = await checkDisabledContext.get('/api/v1');
    expect(disabledRes.status()).toBe(404);
    await checkDisabledContext.dispose();

    // Now enable API for the actual tests
    configObj.ENABLE_API = true;
    fs.writeFileSync(configPath, JSON.stringify(configObj, null, 2), 'utf8');

    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Sign up via the UI to establish a session
    const username = `apitest_${Date.now()}`;
    const password = 'password123';
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page).toHaveURL('/');

    // 2. Extract cookies and configure an API context
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'session')?.value;
    expect(sessionCookie).toBeDefined();

    const tempApiContext = await playwrightRequest.newContext({
      baseURL: 'http://localhost:9002',
      extraHTTPHeaders: {
        Cookie: `session=${sessionCookie}`,
      },
    });

    // 3. Generate a Personal Access Token via the API using the session
    const patRes = await tempApiContext.post('/api/v1/tokens', {
      data: { name: 'Test Token' },
    });
    expect(patRes.status()).toBe(201);
    const patData = await patRes.json();
    patToken = patData.rawToken;
    expect(patToken).toMatch(/^tlab_/);

    await tempApiContext.dispose();
    await context.close();

    // 4. Create the main API context using ONLY the generated PAT (no cookies)
    apiContext = await playwrightRequest.newContext({
      baseURL: 'http://localhost:9002',
      extraHTTPHeaders: {
        Authorization: `Bearer ${patToken}`,
        'Content-Type': 'application/json',
      },
    });
  });

  test.afterAll(async () => {
    // Restore original config.json
    const configPath = path.join(process.cwd(), 'config.json');
    if (originalConfigContent) {
      fs.writeFileSync(configPath, originalConfigContent, 'utf8');
    }
    if (apiContext) {
      await apiContext.dispose();
    }
  });

  test('should fail without valid token', async ({ request }) => {
    const res = await request.get('/api/v1/trees', {
      headers: { Authorization: 'Bearer tlab_invalid123' },
    });
    expect(res.status()).toBe(401);
  });

  test('1. Create a tree', async () => {
    const res = await apiContext.post('/api/v1/trees', {
      data: { title: 'API Test Tree', isPublic: false },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    treeId = data.tree.id;
    expect(treeId).toBeDefined();
    expect(data.tree.title).toBe('API Test Tree');
  });

  test('2. List trees', async () => {
    const res = await apiContext.get('/api/v1/trees');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.count).toBeGreaterThan(0);
    expect(data.trees.some((t: any) => t.id === treeId)).toBeTruthy();
  });

  test('3. Add a template to the tree', async () => {
    const res = await apiContext.post(`/api/v1/trees/${treeId}/templates`, {
      data: {
        name: 'Task Template',
        icon: '✅',
        color: '#ff0000',
        fields: [{ id: 'status', name: 'Status', type: 'dropdown', options: ['Todo', 'Done'] }],
      },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    templateId = data.template.id;
    expect(templateId).toBeDefined();
    expect(data.template.name).toBe('Task Template');
  });

  test('4. Create a node in the tree', async () => {
    const res = await apiContext.post(`/api/v1/trees/${treeId}/nodes`, {
      data: {
        name: 'My First API Node',
        templateId: templateId,
        data: { status: 'Todo' },
      },
    });
    if (res.status() !== 201) {
      console.log('Test 4 Failed:', await res.json());
    }
    expect(res.status()).toBe(201);
    const data = await res.json().catch(() => ({}));
    nodeId = data.node?.id;
    expect(nodeId).toBeDefined();
    expect(data.node.name).toBe('My First API Node');
    expect(data.node.data.status).toBe('Todo');
  });

  test('5. Read nodes from the tree', async () => {
    const res = await apiContext.get(`/api/v1/trees/${treeId}/nodes?format=flat`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.nodes[0].id).toBe(nodeId);
    expect(data.nodes[0].name).toBe('My First API Node');
  });

  test('6. Update the node', async () => {
    const res = await apiContext.patch(`/api/v1/trees/${treeId}/nodes/${nodeId}`, {
      data: {
        name: 'Updated Node Name',
        data: { status: 'Done' },
        isStarred: true,
      },
    });
    expect(res.status()).toBe(200);

    // Verify update
    const getRes = await apiContext.get(`/api/v1/trees/${treeId}/nodes/${nodeId}`);
    const getData = await getRes.json();
    expect(getData.node.name).toBe('Updated Node Name');
    expect(getData.node.data.status).toBe('Done');
    expect(getData.node.isStarred).toBe(true);
  });

  test('7. Clean up tree', async () => {
    const res = await apiContext.delete(`/api/v1/trees/${treeId}`);
    expect(res.status()).toBe(200);

    // Verify deletion
    const checkRes = await apiContext.get(`/api/v1/trees/${treeId}`);
    expect(checkRes.status()).toBe(404);
  });
});
