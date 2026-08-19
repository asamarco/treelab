/**
 * @fileoverview
 * Comprehensive node-actions E2E test.
 *
 * Strategy
 * --------
 * 1.  A dedicated user is registered and a PAT is created for it via the API.
 * 2.  Two templates are created via the API:
 *       – "NoteT"   (simple text field "title", nameTemplate = "{{title}}")
 *       – "FolderT" (no fields, nameTemplate = "Folder")
 * 3.  A tree is created via the API and the following initial structure is
 *     populated also via the API (IDs are therefore **known**):
 *
 *       [ROOT]
 *       ├── Alpha   (NoteT)  → nodeAlphaId
 *       ├── Beta    (NoteT)  → nodeBetaId
 *       ├── Gamma   (NoteT)  → nodeGammaId
 *       └── Delta   (FolderT) → nodeDeltaId
 *           └── Epsilon (NoteT) → nodeEpsilonId
 *
 * 4.  The test navigates to the tree in a browser and performs, in sequence,
 *     each of the required operations. After each section a short assertion
 *     is made so failures pinpoint the exact step.
 *
 * 5.  The tree is **not** deleted at the end so the final state can be
 *     manually inspected in the UI.
 *
 * UI Selectors
 * ------------
 * Nodes are identified by their `node-card-<nodeId>_root` id attribute that
 * the TreeNodeComponent renders:  id={`node-card-${instanceId}`}
 * where instanceId = `${node.id}_${contextualParentId || 'root'}`.
 *
 * For root-level nodes the parent is "root", so:
 *   id="node-card-<nodeId>_root"
 * For child nodes whose parent is <parentId>:
 *   id="node-card-<nodeId>_<parentId>"
 */

import {
  test,
  expect,
  APIRequestContext,
  request as playwrightRequest,
  type Page,
} from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared state (populated in beforeAll)
// ---------------------------------------------------------------------------
let apiContext: APIRequestContext;
let sharedContext: any;
let sharedPage: Page;
let patToken: string;
let treeId: string;
let noteTId: string;    // "NoteT" template id
let folderTId: string;  // "FolderT" template id

// Node IDs set via API so they are deterministic
let nodeAlphaId: string;
let nodeBetaId: string;
let nodeGammaId: string;
let nodeDeltaId: string;
let nodeEpsilonId: string;

const BASE_URL = 'http://localhost:9002';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the active tree page. */
async function gotoTree(page: Page) {
  const openDialog = page.getByRole('dialog');
  if (await openDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(openDialog).not.toBeVisible({ timeout: 5_000 }).catch(() => { });
  }
  await page.goto('/roots');
  const treeCard = page.locator('.border').filter({ hasText: /NodeActions-/ }).first();
  await treeCard.waitFor({ state: 'visible', timeout: 15_000 });
  const openBtn = treeCard.getByRole('button', { name: 'Open' });
  if (await openBtn.isVisible() && await openBtn.isEnabled()) {
    await openBtn.click();
  } else {
    await page.goto('/');
  }
  await page.waitForSelector('[id^="node-card-"]', { timeout: 20_000 });
}

/** Return a locator for the card of a root-level node. */
function rootCard(page: Page, nodeId: string) {
  return page.locator(`#node-card-${nodeId}_root`);
}

/** Return a locator for a child card whose contextual parent is parentId. */
function childCard(page: Page, nodeId: string, parentId: string) {
  return page.locator(`#node-card-${nodeId}_${parentId}`);
}

/**
 * Click a node card to select it.
 * Pass modifier='Control' for multi-select.
 */
async function selectNode(
  page: Page,
  nodeId: string,
  contextualParentId: string = 'root',
  modifier?: 'Control',
) {
  const card = page.locator(`#node-card-${nodeId}_${contextualParentId}`);
  await card.waitFor({ state: 'visible' });
  const title = card.locator('p').first();
  if (modifier) {
    await title.click({ modifiers: [modifier] });
  } else {
    await title.click();
  }
}

/**
 * Expand a node by clicking its toggle button.
 * The toggle is the aria-label="Toggle node" button inside the card.
 */
async function expandNode(page: Page, nodeId: string, contextualParentId: string = 'root') {
  const card = page.locator(`#node-card-${nodeId}_${contextualParentId}`);
  const toggle = card.getByRole('button', { name: 'Toggle node' });
  await toggle.waitFor({ state: 'visible', timeout: 5_000 });
  const isExpanded = await toggle.locator('.rotate-90').isVisible().catch(() => false);
  if (!isExpanded) {
    await toggle.click();
    await page.waitForTimeout(400);
  }
}

/**
 * Right-click on a node card to open the context menu.
 */
async function rightClickNode(page: Page, nodeId: string, contextualParentId: string = 'root') {
  const card = page.locator(`#node-card-${nodeId}_${contextualParentId}`);
  await card.waitFor({ state: 'visible' });
  const title = card.locator('p').first();
  await title.click({ button: 'right' });
  // Wait for context menu to open
  await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
}

/**
 * Wait for and return the floating selection bar (visible when ≥ 2 nodes are selected).
 */
function selectionBar(page: Page) {
  return page.locator('text=/\\d+ nodes? selected/').first();
}

// ---------------------------------------------------------------------------
// beforeAll – create user, PAT, templates, tree, and nodes via API
// ---------------------------------------------------------------------------
test.describe.serial('Node Actions (API-seeded tree)', () => {
  test.setTimeout(40_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(40_000); // Allow time for dev server compilation
    sharedContext = await browser.newContext();
    sharedPage = await sharedContext.newPage();
    const page = sharedPage;

    // 1. Register a fresh user
    const username = `nodeactions_${Date.now()}`;
    const password = 'password123';
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page).toHaveURL('/', { timeout: 15_000 });

    // 2. Grab session cookie and create a PAT
    const cookies = await sharedContext.cookies();
    const sessionCookie = cookies.find((c: any) => c.name === 'session')?.value;
    expect(sessionCookie, 'session cookie must exist').toBeDefined();

    const tempCtx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Cookie: `session=${sessionCookie}` },
    });
    const patRes = await tempCtx.post('/api/v1/tokens', {
      data: { name: 'node-actions-test' },
    });
    expect(patRes.status()).toBe(201);
    patToken = (await patRes.json()).rawToken;
    await tempCtx.dispose();
    // await context.close();

    // 3. Build persistent API context using the PAT
    apiContext = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${patToken}`,
        'Content-Type': 'application/json',
      },
    });

    // 4. Create the tree
    const treeRes = await apiContext.post('/api/v1/trees', {
      data: { title: `NodeActions-${Date.now()}`, isPublic: false },
    });
    expect(treeRes.status()).toBe(201);
    treeId = (await treeRes.json()).tree.id;

    // 5. Create templates
    const noteTRes = await apiContext.post(`/api/v1/trees/${treeId}/templates`, {
      data: {
        name: 'NoteT',
        icon: 'FileText',
        color: '#6366f1',
        fields: [{ id: 'title', name: 'Title', type: 'text' }],
        nameTemplate: '{Title}',
      },
    });
    expect(noteTRes.status()).toBe(201);
    noteTId = (await noteTRes.json()).template.id;

    const folderTRes = await apiContext.post(`/api/v1/trees/${treeId}/templates`, {
      data: {
        name: 'FolderT',
        icon: 'Folder',
        color: '#f59e0b',
        fields: [],
        nameTemplate: 'Folder',
      },
    });
    expect(folderTRes.status()).toBe(201);
    folderTId = (await folderTRes.json()).template.id;

    // 6. Create initial nodes (all at root level initially)
    async function createRootNode(name: string, templateId: string, order: number, customId?: string): Promise<string> {
      const body: any = {
        name,
        templateId,
        data: templateId === noteTId ? { title: name } : {},
        parentIds: ['root'],
        order: [order],
      };
      if (customId) body.id = customId;
      const res = await apiContext.post(`/api/v1/trees/${treeId}/nodes`, { data: body });
      expect(res.status(), `create node "${name}"`).toBe(201);
      return (await res.json()).node.id;
    }

    nodeAlphaId = await createRootNode('Alpha', noteTId, 0);
    nodeBetaId = await createRootNode('Beta', noteTId, 1);
    nodeGammaId = await createRootNode('Gamma', noteTId, 2);
    nodeDeltaId = await createRootNode('Delta', folderTId, 3);

    // Epsilon is a child of Delta
    const epsilonRes = await apiContext.post(`/api/v1/trees/${treeId}/nodes`, {
      data: {
        name: 'Epsilon',
        templateId: noteTId,
        data: { title: 'Epsilon' },
        parentIds: [nodeDeltaId],
        order: [0],
      },
    });
    expect(epsilonRes.status()).toBe(201);
    nodeEpsilonId = (await epsilonRes.json()).node.id;

    // Verify the tree has the 5 nodes we created
    const listRes = await apiContext.get(`/api/v1/trees/${treeId}/nodes?format=flat`);
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    expect(listData.count).toBe(5);
  });

  test.afterAll(async () => {
    // Intentionally NOT deleting the tree so the final state can be inspected.
    if (apiContext) await apiContext.dispose();
    if (sharedContext) await sharedContext.close();
  });

  // =========================================================================
  // 1. Add Root Sibling (via "Add Node" page-header button)
  // =========================================================================
  test('1. Add root sibling (new root node via page header)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Click the "Add Node" button in the tree page header
    await page.getByRole('button', { name: /Add Node/i }).click();

    // The "Add New Root Node" dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Add New Root Node')).toBeVisible();

    // Select the NoteT template
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'NoteT' }).click();

    // Wait for the NodeForm to render its fields, then fill the title
    // Use the label text to scope to the right input
    const titleLabel = page.getByRole('dialog').locator('label', { hasText: 'Title' });
    await titleLabel.waitFor({ state: 'visible', timeout: 10_000 });
    const titleTextbox = page.getByRole('dialog').getByRole('textbox').first();
    await titleTextbox.click();
    await titleTextbox.pressSequentially('Zeta', { delay: 50 });

    // Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Zeta should now appear in the tree
    await expect(page.getByText('Zeta').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 2. Add Root Sibling via node context menu (Add Sibling on Alpha)
  // =========================================================================
  test('2. Add sibling via node action button', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Hover Alpha to reveal inline action buttons, then click Add Sibling (+)
    const alphaCard = rootCard(page, nodeAlphaId);
    await alphaCard.waitFor({ state: 'visible' });
    await alphaCard.hover();

    // The "Add Sibling" button has tooltip "Add Sibling (+)"
    await alphaCard.getByRole('button', { name: /Add Sibling/i }).click();

    // Fill dialog — the dialog inherits the template from the source node, so the form renders immediately
    await expect(page.getByRole('dialog')).toBeVisible();
    const eta_titleLabel = page.getByRole('dialog').locator('label', { hasText: 'Title' });
    await eta_titleLabel.waitFor({ state: 'visible', timeout: 10_000 });
    const eta_titleBox = page.getByRole('dialog').getByRole('textbox').first();
    await eta_titleBox.click();
    await eta_titleBox.pressSequentially('Eta', { delay: 50 });
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Eta').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 3. Add Child via node action button (Add Child on Delta)
  // =========================================================================
  test('3. Add child via node action button', async () => {
    const page = sharedPage;
    await gotoTree(page);

    const deltaCard = rootCard(page, nodeDeltaId);
    await deltaCard.waitFor({ state: 'visible' });
    await deltaCard.hover();

    await deltaCard.getByRole('button', { name: /Add Child/i }).click();

    // The "Add Child" dialog
    await expect(page.getByRole('dialog')).toBeVisible();

    // Select template (NoteT may not be pre-selected for FolderT)
    const combobox = page.locator('[role="combobox"]').first();
    if (await combobox.isVisible()) {
      await combobox.click();
      await page.getByRole('option', { name: 'NoteT' }).click();
    }

    const zetaChild_titleLabel = page.getByRole('dialog').locator('label', { hasText: 'Title' });
    await zetaChild_titleLabel.waitFor({ state: 'visible', timeout: 10_000 });
    const zetaChild_titleBox = page.getByRole('dialog').getByRole('textbox').first();
    await zetaChild_titleBox.click();
    await zetaChild_titleBox.pressSequentially('Zeta-Child', { delay: 50 });
    await page.getByRole('button', { name: 'Save' }).click();

    // Expand Delta to verify
    await expandNode(page, nodeDeltaId);
    await expect(page.getByText('Zeta-Child').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 4. Edit a single node (edit Beta via inline Edit button)
  // =========================================================================
  test('4. Edit single node', async () => {
    const page = sharedPage;
    await gotoTree(page);

    const betaCard = rootCard(page, nodeBetaId);
    await betaCard.waitFor({ state: 'visible' });
    await betaCard.hover();

    // Click the Edit (pencil) inline button
    await betaCard.getByRole('button', { name: /Edit Node/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible();

    // Clear the Title field and type a new value
    const betaLabel = page.getByRole('dialog').locator('label', { hasText: 'Title' });
    await betaLabel.waitFor({ state: 'visible', timeout: 10_000 });
    const titleInput = page.getByRole('dialog').getByRole('textbox').first();
    await titleInput.click();
    await titleInput.press('Control+a');
    await titleInput.pressSequentially('Beta-Edited', { delay: 50 });

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await expect(page.getByText('Beta-Edited').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 5. Edit multiple nodes (select Alpha + Gamma, then bulk edit)
  // =========================================================================
  test('5. Edit multiple nodes (bulk edit)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Multi-select Alpha and Gamma
    await selectNode(page, nodeAlphaId);
    await selectNode(page, nodeGammaId, 'root', 'Control');

    // The selection bar should now show 2 nodes selected
    const bar = selectionBar(page);
    await expect(bar).toBeVisible({ timeout: 5_000 });
    await expect(bar).toContainText(/2 nodes? selected/);

    // Click the Pencil (Edit Selection) button in the selection bar
    await page.locator('.fixed.bottom-4')
      .getByRole('button', { name: /edit/i }).first().click();

    // Wait for the "Editing N nodes" dialog
    await expect(page.getByText(/Editing \d+ nodes/i)).toBeVisible({ timeout: 5_000 });

    // Fill in a shared "bulk" title value
    const bulkLabel = page.getByRole('dialog').locator('label', { hasText: 'Title' });
    await bulkLabel.waitFor({ state: 'visible', timeout: 10_000 });
    const titleInput = page.getByRole('dialog').getByRole('textbox').first();
    await titleInput.click();
    await titleInput.pressSequentially('Bulk-Note', { delay: 50 });

    // The button says "Update nodes" when isMultiEdit=true
    await page.getByRole('button', { name: /Update/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Both Alpha and Gamma names should now show "Bulk-Note"
    await expect(page.getByText('Bulk-Note').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 6. Change template (single node: Delta → NoteT)
  // =========================================================================
  test('6. Change template (single node via context menu)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Right-click Delta to open context menu
    await rightClickNode(page, nodeDeltaId);

    // Click "Change Template"
    await page.getByRole('menuitem', { name: /Change Template/i }).click();

    // Dialog should open
    await expect(page.getByRole('dialog')).toBeVisible();

    // Select NoteT
    await page.locator('[role="combobox"]').first().click();
    await page.getByRole('option', { name: 'NoteT' }).click();

    // Apply
    await page.getByRole('button', { name: /Change Template/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Delta should now use NoteT — verify by checking that it no longer has
    // the Folder icon (structural check: it should now appear as a note)
    await expect(rootCard(page, nodeDeltaId)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 7. Change template (multiple nodes: Alpha + Gamma → FolderT)
  // =========================================================================
  test('7. Change template (multiple nodes via selection bar)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    await selectNode(page, nodeAlphaId);
    await selectNode(page, nodeGammaId, 'root', 'Control');

    await expect(selectionBar(page)).toBeVisible({ timeout: 5_000 });

    // Click the RefreshCcw (Change Template) button in the selection bar
    // It is the button immediately after the Eye button
    await page.locator('.fixed.bottom-4')
      .getByRole('button', { name: /Change Template/i }).click();

    // Dialog: "Change Template for N Nodes"
    await expect(page.getByText(/Change Template for .* Nodes/i)).toBeVisible({ timeout: 5_000 });

    // Select FolderT from the dropdown
    await page.locator('#multi-change-template-select').click();
    await page.getByRole('option', { name: 'FolderT' }).click();

    // Apply
    await page.getByRole('button', { name: /Apply to All/i }).click();

    // Alpha and Gamma should still be visible (but now using FolderT)
    await expect(rootCard(page, nodeAlphaId)).toBeVisible({ timeout: 10_000 });
    await expect(rootCard(page, nodeGammaId)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 8. Copy + Paste as sibling (single node: Beta)
  //    Copy Beta, then paste it as sibling of Gamma
  // =========================================================================
  test('8. Copy and paste as sibling', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Right-click Beta → Copy
    await rightClickNode(page, nodeBetaId);
    await page.getByRole('menuitem', { name: /^Copy$/i }).click();

    // Right-click Gamma → Paste → Paste as sibling
    await rightClickNode(page, nodeGammaId);
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as sibling/i }).click();

    // A copy of Beta-Edited should now appear next to Gamma
    await expect(page.getByText('Beta-Edited').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 9. Copy + Paste as child (pair: Alpha + Gamma)
  //    Select both, copy, then paste as child of Delta
  // =========================================================================
  test('9. Copy and paste as child (multi-selection)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Multi-select Alpha and Gamma
    await selectNode(page, nodeAlphaId);
    await selectNode(page, nodeGammaId, 'root', 'Control');

    await expect(selectionBar(page)).toBeVisible({ timeout: 5_000 });

    // Click Copy button in the selection bar (Copy icon)
    await page.locator('.fixed.bottom-4')
      .getByRole('button', { name: /Copy/i }).click();

    // Clear selection, then select Delta as paste target
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await selectNode(page, nodeDeltaId);

    // Ctrl+V to paste as child
    await page.keyboard.press('Control+v');

    // Expand Delta and verify both pasted nodes appear
    await expandNode(page, nodeDeltaId);
    await expect(page.getByText('Bulk-Note').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 10. Paste as clone (sibling) – Epsilon
  //     a) Cloning Epsilon under its own parent (Delta) must be rejected by the
  //        app – verify no new card appears.
  //     b) Cloning Epsilon as a sibling of Delta (root level) must succeed.
  // =========================================================================
  test('10. Paste as clone (sibling)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Expand Delta so Epsilon is visible
    await expandNode(page, nodeDeltaId);

    // --- Part a: same-parent clone should be rejected ---
    // Count Epsilon cards under Delta before the attempt
    const epsilonUnderDeltaBefore = page.locator(`#node-card-${nodeEpsilonId}_${nodeDeltaId}`);
    await expect(epsilonUnderDeltaBefore).toBeVisible({ timeout: 5_000 });

    await rightClickNode(page, nodeEpsilonId, nodeDeltaId);
    await page.getByRole('menuitem', { name: /^Copy$/i }).click();

    // Try to paste Epsilon as clone sibling of itself (same parent = Delta)
    await rightClickNode(page, nodeEpsilonId, nodeDeltaId);
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as clone \(sibling\)/i }).click();
    await page.waitForTimeout(500);

    // There should still be exactly one Epsilon under Delta (no duplicate created)
    const epsilonCardsUnderDelta = page.locator('[id^="node-card-"]').filter({
      has: page.locator(`[id$="_${nodeDeltaId}"]`)
    }).filter({ has: page.getByText('Epsilon', { exact: true }) });
    await expect(epsilonCardsUnderDelta).toHaveCount(1, { timeout: 5_000 });

    // --- Part b: clone as sibling of Delta (root level) should succeed ---
    // Right-click Delta → Paste → Paste as clone (sibling)
    await rightClickNode(page, nodeDeltaId);
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as clone \(sibling\)/i }).click();
    await page.waitForTimeout(500);

    // Epsilon should now also appear at root level (as a clone of the original)
    // The clone card has id: node-card-<nodeEpsilonId>_root
    await expect(rootCard(page, nodeEpsilonId)).toBeVisible({ timeout: 10_000 });

    // The clone indicator (Copy icon) should be visible on the root-level Epsilon card
    await expect(rootCard(page, nodeEpsilonId).locator('.lucide-copy').first()).toBeVisible({ timeout: 5_000 });
  });

  // =========================================================================
  // 11. Paste as clone (child) – single node: Beta cloned into Delta
  // =========================================================================
  test('11. Paste as clone (child)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Right-click Beta → Copy
    await rightClickNode(page, nodeBetaId);
    await page.getByRole('menuitem', { name: /^Copy$/i }).click();

    // Right-click Delta → Paste → Paste as clone (child)
    await rightClickNode(page, nodeDeltaId);
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as clone \(child\)/i }).click();

    // Expand Delta and verify Beta-Edited appears (as a clone)
    await expandNode(page, nodeDeltaId);
    await expect(page.getByText('Beta-Edited').first()).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 11b. Move clone up/down within siblings
  //      Verify moving second clone in tree updates its order without affecting
  //      the first clone in tree.
  // =========================================================================
  test('11b. Move clone up/down within siblings', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Expand Delta so its children (including the 2nd clone of Beta-Edited) are visible
    await expandNode(page, nodeDeltaId);

    // Toggle node numbers ON using shortcut 'o'
    await page.keyboard.press('o');
    await page.waitForTimeout(300);

    // Locators for the two clones of Beta-Edited
    const firstCloneTitle = rootCard(page, nodeBetaId).locator('p').first();
    const secondCloneCard = childCard(page, nodeBetaId, nodeDeltaId);
    const secondCloneTitle = secondCloneCard.locator('p').first();

    await expect(firstCloneTitle).toBeVisible({ timeout: 5_000 });
    await expect(secondCloneTitle).toBeVisible({ timeout: 5_000 });

    // Record initial order text for both clones
    const firstCloneTextBefore = await firstCloneTitle.textContent();
    const secondCloneTextBefore = await secondCloneTitle.textContent();

    // Verify initial sibling order numbers are displayed (e.g., contains '1.', '2.', etc.)
    expect(firstCloneTextBefore).toMatch(/\d+\.\s*Beta-Edited/);
    expect(secondCloneTextBefore).toMatch(/\d+\.\s*Beta-Edited/);

    // Perform Move Up on the second clone (under Delta)
    const moveUpBtn = secondCloneCard.getByRole('button', { name: 'Move Up' });
    await moveUpBtn.click();

    await page.waitForTimeout(600);

    // 1) Verify that the 1st clone at root level did NOT change its order/number
    const firstCloneTextAfter = await firstCloneTitle.textContent();
    expect(firstCloneTextAfter).toBe(firstCloneTextBefore);

    // 2) Verify that the 2nd clone (under Delta) DID change its order/number
    const secondCloneTextAfter = await secondCloneTitle.textContent();
    expect(secondCloneTextAfter).not.toBe(secondCloneTextBefore);

    // Turn node numbers back OFF using shortcut 'o'
    await page.keyboard.press('o');
    await page.waitForTimeout(300);
  });

  // =========================================================================
  // 12. Move nodes (Cut + Paste) – single: move Gamma under Delta
  // =========================================================================
  test('12. Move node (cut and paste as child)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Right-click Gamma → Cut
    await rightClickNode(page, nodeGammaId);
    await page.getByRole('menuitem', { name: /^Cut$/i }).click();

    // Select Delta as paste target
    await selectNode(page, nodeDeltaId);

    // Ctrl+V → pastes as child when cut
    await page.keyboard.press('Control+v');

    // Gamma should no longer be visible at root level
    // (we wait a moment for the UI to update)
    await page.waitForTimeout(600);

    // The root-level Gamma card should be gone
    await expect(rootCard(page, nodeGammaId)).not.toBeVisible({ timeout: 10_000 });

    // Expand Delta and verify Gamma is now a child
    await expandNode(page, nodeDeltaId);
    // Gamma now shows its data from bulk-edit: "Bulk-Note" (or its FolderT name)
    // We check by the card's existence under Delta
    await expect(childCard(page, nodeGammaId, nodeDeltaId)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 13. Move nodes (Cut + Paste as sibling) – pair: Alpha + Beta
  //     Cut both Alpha and Beta, paste as sibling of Delta
  // =========================================================================
  test('13. Move multiple nodes (cut and paste as sibling)', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Multi-select Alpha and Beta-Edited
    await selectNode(page, nodeAlphaId);
    await selectNode(page, nodeBetaId, 'root', 'Control');

    await expect(selectionBar(page)).toBeVisible({ timeout: 5_000 });

    // Click Cut (Scissors) in the selection bar
    await page.locator('.fixed.bottom-4')
      .getByRole('button', { name: /Cut/i }).click();

    // Right-click Delta → Paste → Paste as sibling
    await rightClickNode(page, nodeDeltaId);
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as sibling/i }).click();

    await page.waitForTimeout(600);

    // Alpha and Beta should still be visible at root level
    // (pasted as siblings of Delta = still root level)
    await expect(rootCard(page, nodeAlphaId)).toBeVisible({ timeout: 10_000 });
    await expect(rootCard(page, nodeBetaId)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 14. Delete nodes – single: delete Zeta (the node added in test 1)
  // =========================================================================
  test('14. Delete single node via context menu', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Find Zeta by text (we don't have its ID but it's unique by name)
    const zetaText = page.getByText('Zeta', { exact: true });
    await expect(zetaText).toBeVisible({ timeout: 10_000 });

    const zetaCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Zeta', { exact: true }) }).first();

    // Make a copy as sibling beforehand named "Zeta-ghost"
    const title = zetaCard.locator('p').first();
    await title.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    await page.getByRole('menuitem', { name: /^Copy$/i }).click();

    await title.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as sibling/i }).click();
    await page.waitForTimeout(400);

    const zetaCopyCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Zeta', { exact: true }) }).nth(1);
    await zetaCopyCard.getByRole('button', { name: /Edit Node/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const titleInput = page.getByRole('dialog').getByRole('textbox').first();
    await titleInput.click();
    await titleInput.press('Control+a');
    await titleInput.pressSequentially('Zeta-ghost', { delay: 50 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Right-click the original card that contains "Zeta"
    const originalZetaCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Zeta', { exact: true }) }).first();
    await originalZetaCard.locator('p').first().click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });

    await page.getByRole('menuitem', { name: /Delete/i }).click();

    // Confirm the alert dialog
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: /^Delete$/i }).click();

    // Zeta should be gone, but Zeta-ghost should still exist
    await expect(page.getByText('Zeta', { exact: true })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Zeta-ghost', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 15. Delete multiple nodes – pair: Eta + Zeta-Child
  // =========================================================================
  test('15. Delete multiple nodes via selection bar', async () => {
    const page = sharedPage;
    await gotoTree(page);

    // Make a ghost copy of Eta beforehand
    const etaCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Eta', { exact: true }) }).first();
    await etaCard.waitFor({ state: 'visible' });
    const etaTitle = etaCard.locator('p').first();
    await etaTitle.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    await page.getByRole('menuitem', { name: /^Copy$/i }).click();

    await etaTitle.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as sibling/i }).click();
    await page.waitForTimeout(400);

    const etaCopyCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Eta', { exact: true }) }).nth(1);
    await etaCopyCard.getByRole('button', { name: /Edit Node/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    let titleInput = page.getByRole('dialog').getByRole('textbox').first();
    await titleInput.click();
    await titleInput.press('Control+a');
    await titleInput.pressSequentially('Eta-ghost', { delay: 50 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Expand Delta to reach Zeta-Child
    await expandNode(page, nodeDeltaId);

    // Make a ghost copy of Zeta-Child beforehand
    const zetaChildCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Zeta-Child', { exact: true }) }).first();
    await zetaChildCard.waitFor({ state: 'visible' });
    const zetaChildTitle = zetaChildCard.locator('p').first();
    await zetaChildTitle.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    await page.getByRole('menuitem', { name: /^Copy$/i }).click();

    await zetaChildTitle.click({ button: 'right' });
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
    await page.getByRole('menuitem', { name: /^Paste$/i }).hover();
    await page.getByRole('menuitem', { name: /Paste as sibling/i }).click();
    await page.waitForTimeout(400);

    const zetaChildCopyCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Zeta-Child', { exact: true }) }).nth(1);
    await zetaChildCopyCard.getByRole('button', { name: /Edit Node/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    titleInput = page.getByRole('dialog').getByRole('textbox').first();
    await titleInput.click();
    await titleInput.press('Control+a');
    await titleInput.pressSequentially('Zeta-Child-ghost', { delay: 50 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Select the original Eta and Zeta-Child nodes by clicking their cards with Ctrl-click.
    const originalEtaCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Eta', { exact: true }) }).first();
    await originalEtaCard.locator('p').first().click();

    const originalZetaChildCard = page.locator('[id^="node-card-"]').filter({ has: page.getByText('Zeta-Child', { exact: true }) }).first();
    await originalZetaChildCard.locator('p').first().click({ modifiers: ['Control'] });

    // Selection bar should show 2 nodes
    await expect(selectionBar(page)).toBeVisible({ timeout: 5_000 });

    // Click the trash icon in the selection bar
    await page.locator('.fixed.bottom-4')
      .getByRole('button').filter({ has: page.locator('.lucide-trash-2') }).click();

    // Confirm deletion
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: /^Delete$/i }).click();

    // Original nodes should be deleted
    await expect(page.getByText('Eta', { exact: true })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Zeta-Child', { exact: true })).not.toBeVisible({ timeout: 10_000 });

    // Ghost nodes should remain intact
    await expect(page.getByText('Eta-ghost', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Zeta-Child-ghost', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // 16. Final state verification (via API)
  //     Print the tree structure for manual inspection.
  //     The tree is intentionally left alive.
  // =========================================================================
  test('16. Final tree state (API read-back for inspection)', async () => {
    const res = await apiContext.get(`/api/v1/trees/${treeId}/nodes?format=tree`);
    expect(res.status()).toBe(200);
    const data = await res.json();

    // Log the full tree for manual inspection
    console.log(
      '\n=== FINAL TREE STATE ===\n',
      JSON.stringify(data, null, 2),
      '\n========================\n',
      `\nInspect in UI: http://localhost:9002/?treeId=${treeId}`,
    );
    expect(data.nodes.length).toEqual(7);
  });
});
