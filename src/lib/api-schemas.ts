/**
 * @fileoverview
 * Single source of truth for the Treelab REST API contract.
 *
 * This module does two things simultaneously:
 *  1. Defines Zod schemas used for **runtime request validation** in every route handler.
 *  2. Registers those same schemas + all route paths with the OpenAPI registry,
 *     so that `generateOpenApiDocument()` can produce a full, accurate OpenAPI 3.1 spec.
 *
 * Import the Zod schemas into route handlers for `safeParse()` validation.
 * Import `generateOpenApiDocument` into the /api/v1/openapi route to serve the spec.
 *
 * IMPORTANT: `extendZodWithOpenApi(z)` must run before any schema is defined.
 * This file takes care of that — never call it elsewhere.
 */

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------
/** Keys that must never appear in user-supplied record objects (prototype pollution). */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/** A z.record(z.string(), z.unknown()) with prototype-pollution protection. */
const safeRecord = () =>
  z.record(z.string(), z.unknown()).refine(
    (obj) => !Object.keys(obj).some((k) => DANGEROUS_KEYS.includes(k)),
    { message: 'Invalid field key.' },
  );

// ---------------------------------------------------------------------------
// Security scheme
// ---------------------------------------------------------------------------
registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'PAT',
  description:
    'Personal Access Token (prefix: `tlab_`). Generate one in **Settings → Personal Access Tokens**.',
});

const sec = [{ BearerAuth: [] }];

// ---------------------------------------------------------------------------
// Common schemas
// ---------------------------------------------------------------------------
export const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z
    .object({
      error: z.string().openapi({ example: 'Validation failed' }),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .openapi('ErrorResponse'),
);

// ---------------------------------------------------------------------------
// Token schemas
// ---------------------------------------------------------------------------
export const TokenMetaSchema = registry.register(
  'TokenMeta',
  z
    .object({
      id: z.string().openapi({ example: '507f1f77bcf86cd799439011' }),
      name: z.string().openapi({ example: 'CI script' }),
      prefix: z.string().openapi({ example: 'tlab_a3f', description: 'First 8 chars of the raw token for identification.' }),
      createdAt: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
      lastUsedAt: z.string().optional().openapi({ example: '2024-06-01T08:00:00.000Z' }),
      expiresAt: z.string().optional().openapi({ example: '2025-01-15T00:00:00.000Z', description: 'Absent if token never expires.' }),
    })
    .openapi('TokenMeta'),
);

export const CreateTokenBodySchema = z.object({
  name: z.string().min(1).max(100).openapi({
    example: 'My CI script',
    description: 'Human-readable label. Shown in Settings alongside the token prefix.',
  }),
  expiresAt: z.string().datetime().optional().openapi({
    example: '2025-12-31T23:59:59.000Z',
    description: 'ISO 8601 expiry date-time. Omit for a non-expiring token.',
  }),
}).strict();

export const CreateTokenResponseSchema = registry.register(
  'CreateTokenResponse',
  z
    .object({
      token: TokenMetaSchema,
      rawToken: z.string().openapi({
        example: 'tlab_a3f9b12c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        description: 'The full token value. **Shown once only** — store it immediately.',
      }),
      notice: z.string(),
    })
    .openapi('CreateTokenResponse'),
);

// ---------------------------------------------------------------------------
// Field schema (building block for Template)
// ---------------------------------------------------------------------------
export const FieldTypeEnum = z.enum([
  'text', 'number', 'date', 'dropdown', 'textarea', 'link',
  'picture', 'table-header', 'dynamic-dropdown', 'attachment',
  'xy-chart', 'query', 'checklist', 'checkbox', 'spreadsheet', 'embed',
]);

export const FieldSchema = registry.register(
  'Field',
  z
    .object({
      id: z.string().openapi({ example: 'field_abc123' }),
      name: z.string().openapi({ example: 'Status' }),
      type: FieldTypeEnum.openapi({ example: 'dropdown' }),
      options: z.array(z.string()).max(200).optional().openapi({ example: ['Open', 'In Progress', 'Done'], description: 'For dropdown / dynamic-dropdown fields.' }),
      columnType: z.enum(['text', 'number', 'date']).optional(),
      height: z.number().optional(),
      prefix: z.string().optional(),
      postfix: z.string().optional(),
      spreadsheetRowCount: z.number().optional(),
      spreadsheetColumnCount: z.number().optional(),
    })
    .openapi('Field'),
);

// ---------------------------------------------------------------------------
// Template schemas
// ---------------------------------------------------------------------------
export const ConditionalRuleOperatorEnum = z.enum([
  'equals', 'not_equals', 'contains', 'not_contains',
  'is_not_empty', 'is_empty', 'greater_than', 'less_than',
]);

export const ConditionalRuleSchema = registry.register(
  'ConditionalRule',
  z.object({
    id: z.string().max(100),
    fieldId: z.string().max(100),
    operator: ConditionalRuleOperatorEnum,
    value: z.string().max(1000),
    icon: z.string().max(50),
    color: z.string().max(50),
  }).strict().openapi('ConditionalRule')
);
export const TemplateSchema = registry.register(
  'Template',
  z
    .object({
      id: z.string().openapi({ example: 'tmpl_abc123' }),
      name: z.string().openapi({ example: 'Task' }),
      icon: z.string().optional().openapi({ example: '📋' }),
      color: z.string().optional().openapi({ example: '#6366f1' }),
      fields: z.array(FieldSchema).max(100).default([]),
      conditionalRules: z.array(ConditionalRuleSchema).max(50).default([]),
      preferredChildTemplates: z.array(z.string()).max(50).default([]),
      nameTemplate: z.string().optional().openapi({ description: 'Handlebars-style template for auto-generating node names.' }),
      bodyTemplate: z.string().optional(),
    })
    .openapi('Template'),
);

export const CreateTemplateBodySchema = z.object({
  name: z.string().min(1).max(200).openapi({ example: 'Task' }),
  id: z.string().max(100).optional().openapi({ description: 'Client-generated ID. One is auto-generated if omitted.' }),
  icon: z.string().max(50).optional(),
  color: z.string().max(50).optional(),
  fields: z.array(FieldSchema).max(100).default([]),
  conditionalRules: z.array(ConditionalRuleSchema).max(50).default([]),
  preferredChildTemplates: z.array(z.string()).max(50).default([]),
  nameTemplate: z.string().max(1000).optional(),
  bodyTemplate: z.string().max(5000).optional(),
}).strict();

// ---------------------------------------------------------------------------
// Tree schemas
// ---------------------------------------------------------------------------
export const TreeSummarySchema = registry.register(
  'TreeSummary',
  z
    .object({
      id: z.string().openapi({ example: '507f1f77bcf86cd799439011' }),
      title: z.string().openapi({ example: 'My Project' }),
      isPublic: z.boolean().openapi({ example: false }),
      createdAt: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
      updatedAt: z.string().openapi({ example: '2024-06-01T08:00:00.000Z' }),
      templateCount: z.number().openapi({ example: 3 }),
      nodeCount: z.number().openapi({ example: 42 }),
    })
    .openapi('TreeSummary'),
);

export const CreateTreeBodySchema = z.object({
  title: z.string().min(1).max(500).openapi({ example: 'My New Tree' }),
  isPublic: z.boolean().default(false),
  templates: z.array(CreateTemplateBodySchema).max(100).default([]).openapi({ description: 'Optional initial templates.' }),
}).strict();

export const PatchTreeBodySchema = z
  .object({
    title: z.string().min(1).max(500).optional().openapi({ example: 'Renamed Tree' }),
    isPublic: z.boolean().optional(),
    templates: z.array(CreateTemplateBodySchema).max(100).optional(),
    expandedNodeIds: z.array(z.string()).max(5000).optional(),
    lastDrilledNodeId: z.string().nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided.' })
  .openapi({ description: 'At least one field must be provided.' });

// ---------------------------------------------------------------------------
// Node schemas
// ---------------------------------------------------------------------------
export const NodeFlatSchema = registry.register(
  'NodeFlat',
  z
    .object({
      id: z.string().openapi({ example: 'kf123abc-xyz789def' }),
      name: z.string().openapi({ example: 'Implement login' }),
      templateId: z.string().openapi({ example: 'tmpl_abc123' }),
      data: z.record(z.string(), z.unknown()).openapi({ description: 'Field values keyed by field ID.' }),
      parentIds: z.array(z.string()).openapi({ example: ['root'] }),
      order: z.array(z.number()).openapi({ example: [0] }),
      treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }),
      userId: z.string().openapi({ example: '507f1f77bcf86cd799439012' }),
      isStarred: z.boolean().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .openapi('NodeFlat'),
);

export const CreateNodeBodySchema = z.object({
  name: z.string().min(1).max(1000).openapi({ example: 'Implement login' }),
  templateId: z.string().min(1).max(100).openapi({ example: 'tmpl_abc123' }),
  id: z.string().max(100).optional().openapi({ description: 'Client-generated ID. One is auto-generated if omitted.' }),
  data: safeRecord().default({}).openapi({ description: 'Field values keyed by field ID.' }),
  parentIds: z.array(z.string()).max(20).default(['root']).openapi({ example: ['root'], description: 'Use `["root"]` for top-level nodes.' }),
  order: z.array(z.number()).max(20).optional().openapi({
    description: 'Position index per parent. `order[i]` is the zero-based rank of this node under `parentIds[i]`. ' +
      'If omitted the server appends the node after the last existing sibling (safe default for sequential imports). ' +
      'Pass an explicit value only when you need precise placement.',
    example: [2],
  }),
  isStarred: z.boolean().default(false),
}).strict();

export const PatchNodeBodySchema = z
  .object({
    name: z.string().min(1).max(1000).optional(),
    data: safeRecord().optional().openapi({ description: 'Partial or full field values. Merged server-side.' }),
    templateId: z.string().max(100).optional(),
    isStarred: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided.' })
  .openapi({ description: 'At least one field must be provided. Structural changes (move, reorder) are not supported via API.' });

// ---------------------------------------------------------------------------
// Query param schemas (used in route handlers)
// ---------------------------------------------------------------------------
export const FormatQuerySchema = z.enum(['flat', 'tree']).default('flat');

// ---------------------------------------------------------------------------
// Route registrations
// ---------------------------------------------------------------------------

// ── Tokens ──────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/api/v1/tokens', tags: ['Tokens'],
  summary: 'List Personal Access Tokens',
  description: 'Returns all PATs belonging to the authenticated user. Raw token values are never returned.',
  security: sec,
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ tokens: z.array(TokenMetaSchema) }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/v1/tokens', tags: ['Tokens'],
  summary: 'Create a Personal Access Token',
  description: 'Returns the raw token value **exactly once**. Store it securely before closing the response.',
  security: sec,
  request: { body: { required: true, content: { 'application/json': { schema: CreateTokenBodySchema } } } },
  responses: {
    201: { description: 'Token created', content: { 'application/json': { schema: CreateTokenResponseSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete', path: '/api/v1/tokens/{tokenId}', tags: ['Tokens'],
  summary: 'Revoke a Personal Access Token',
  security: sec,
  request: { params: z.object({ tokenId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }) },
  responses: {
    200: { description: 'Token revoked', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Token not found or not owned by caller', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// ── Trees ────────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/api/v1/trees', tags: ['Trees'],
  summary: 'List all accessible trees',
  description: 'Returns all trees owned by or shared with the caller. Node data is excluded; use the `/nodes` sub-resource.',
  security: sec,
  request: {
    query: z.object({
      name: z.string().optional().openapi({ description: 'Case-insensitive substring filter on tree title.' }),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ trees: z.array(TreeSummarySchema), count: z.number() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/v1/trees', tags: ['Trees'],
  summary: 'Create a new tree',
  security: sec,
  request: { body: { required: true, content: { 'application/json': { schema: CreateTreeBodySchema } } } },
  responses: {
    201: { description: 'Tree created' },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get', path: '/api/v1/trees/{treeId}', tags: ['Trees'],
  summary: 'Get tree metadata and templates',
  description: 'Returns tree metadata and all embedded templates. Use `/nodes` to retrieve node data.',
  security: sec,
  request: { params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }) },
  responses: {
    200: { description: 'OK' },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Tree not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch', path: '/api/v1/trees/{treeId}', tags: ['Trees'],
  summary: 'Update tree title or settings',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }),
    body: { required: true, content: { 'application/json': { schema: PatchTreeBodySchema } } },
  },
  responses: {
    200: { description: 'Updated' },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete', path: '/api/v1/trees/{treeId}', tags: ['Trees'],
  summary: 'Delete a tree and all its nodes',
  description: 'Permanently deletes the tree, all its nodes, and associated data. Only the owner can delete.',
  security: sec,
  request: { params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden — only the tree owner can delete', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// ── Templates ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/api/v1/trees/{treeId}/templates', tags: ['Templates'],
  summary: 'List all templates in a tree',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }),
    query: z.object({
      name: z.string().optional().openapi({ description: 'Case-insensitive substring filter on template name.' }),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ templates: z.array(TemplateSchema), count: z.number() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Tree not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/v1/trees/{treeId}/templates', tags: ['Templates'],
  summary: 'Add a template to a tree',
  description: 'Requires `editTemplates` permission on the tree.',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }),
    body: { required: true, content: { 'application/json': { schema: CreateTemplateBodySchema } } },
  },
  responses: {
    201: { description: 'Template created', content: { 'application/json': { schema: z.object({ template: TemplateSchema }) } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden — requires editTemplates permission', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get', path: '/api/v1/trees/{treeId}/templates/{templateId}', tags: ['Templates'],
  summary: 'Get a single template',
  security: sec,
  request: { params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }), templateId: z.string().openapi({ example: 'tmpl_abc123' }) }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ template: TemplateSchema }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Tree or template not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'put', path: '/api/v1/trees/{treeId}/templates/{templateId}', tags: ['Templates'],
  summary: 'Replace a template',
  description: 'Merges provided fields with existing values. The template `id` is immutable.',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }), templateId: z.string().openapi({ example: 'tmpl_abc123' }) }),
    body: { required: true, content: { 'application/json': { schema: CreateTemplateBodySchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: z.object({ template: TemplateSchema }) } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Template not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete', path: '/api/v1/trees/{treeId}/templates/{templateId}', tags: ['Templates'],
  summary: 'Delete a template from a tree',
  security: sec,
  request: { params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }), templateId: z.string().openapi({ example: 'tmpl_abc123' }) }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ message: z.string() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Template not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// ── Nodes ────────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/api/v1/trees/{treeId}/nodes', tags: ['Nodes'],
  summary: 'List all nodes in a tree',
  description: 'Returns nodes in flat (default) or hierarchical format. When `name` is supplied the response is always flat.',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }),
    query: z.object({
      format: z.enum(['flat', 'tree']).default('flat').openapi({
        description: '`flat` — array matching the `tree.json` export format. `tree` — nested children arrays. Ignored when any filter is set.',
      }),
      name: z.string().optional().openapi({ description: 'Case-insensitive substring filter on node name.' }),
      templateId: z.string().optional().openapi({ description: 'Exact match on `templateId`. Returns only nodes belonging to this template.' }),
      templateName: z.string().optional().openapi({ description: 'Case-insensitive substring match on the template name. Resolved server-side to matching template IDs.' }),
    }),
  },
  responses: {
    200: {
      description: 'OK',
      content: {
        'application/json': {
          schema: z.object({ nodes: z.array(NodeFlatSchema), count: z.number(), format: z.enum(['flat', 'tree']) }),
        },
      },
    },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'post', path: '/api/v1/trees/{treeId}/nodes', tags: ['Nodes'],
  summary: 'Create a node in a tree',
  description: 'Requires `editNodes` permission on the tree.',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }) }),
    body: { required: true, content: { 'application/json': { schema: CreateNodeBodySchema } } },
  },
  responses: {
    201: { description: 'Node created', content: { 'application/json': { schema: z.object({ node: NodeFlatSchema }) } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden — requires editNodes permission', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'get', path: '/api/v1/trees/{treeId}/nodes/{nodeId}', tags: ['Nodes'],
  summary: 'Get a single node',
  security: sec,
  request: { params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }), nodeId: z.string().openapi({ example: 'kf123abc-xyz789def' }) }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ node: NodeFlatSchema }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Node not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'patch', path: '/api/v1/trees/{treeId}/nodes/{nodeId}', tags: ['Nodes'],
  summary: 'Update node content',
  description: 'Updates content fields only (`name`, `data`, `templateId`, `isStarred`). Structural operations (move, reorder, clone) are only available via the web application.',
  security: sec,
  request: {
    params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }), nodeId: z.string().openapi({ example: 'kf123abc-xyz789def' }) }),
    body: { required: true, content: { 'application/json': { schema: PatchNodeBodySchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: z.object({ message: z.string(), updatedAt: z.string() }) } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
    404: { description: 'Node not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: 'delete', path: '/api/v1/trees/{treeId}/nodes/{nodeId}', tags: ['Nodes'],
  summary: 'Delete a node and its descendants',
  description: 'Permanently deletes the node and all child nodes that have no other parents. Cloned nodes (multi-parent) are only unlinked.',
  security: sec,
  request: { params: z.object({ treeId: z.string().openapi({ example: '507f1f77bcf86cd799439011' }), nodeId: z.string().openapi({ example: 'kf123abc-xyz789def' }) }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: z.object({ message: z.string(), deletedIds: z.array(z.string()), deletedAt: z.string() }) } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorResponseSchema } } },
  },
});

// ---------------------------------------------------------------------------
// OpenAPI document generator
// ---------------------------------------------------------------------------
export function generateOpenApiDocument(baseUrl = '') {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Treelab REST API',
      version: '1.0.0',
      description: `
REST API for programmatic access to Treelab trees, templates, and nodes.

## Authentication

Generate a **Personal Access Token** in **Settings → Personal Access Tokens**, then pass it as:

\`\`\`
Authorization: Bearer tlab_your_token_here
\`\`\`

## Rate Limiting

**120 requests per 60 seconds (default; may be configurable)** per authenticated user. Responses include:
- \`X-RateLimit-Remaining\` — requests left in the current window
- \`X-RateLimit-Reset\` — Unix timestamp when the window resets
- \`Retry-After\` — seconds to wait (on 429 responses only)

## Permissions

API access inherits the tree permission model:
| Role | Trees | Nodes | Templates |
|------|-------|-------|-----------|
| Owner | Full CRUD | Full CRUD | Full CRUD |
| editNodes | Read | Full CRUD | Read |
| editTemplates | Read | Read | Full CRUD |
| Read-only | Read | Read | Read |
      `,
    },
    servers: [{ url: baseUrl, description: 'Current server' }],
    tags: [
      { name: 'Tokens', description: 'Manage Personal Access Tokens for API authentication' },
      { name: 'Trees', description: 'Create, read, update, and delete trees' },
      { name: 'Templates', description: 'Manage templates embedded within a tree' },
      { name: 'Nodes', description: 'Create, read, update, and delete nodes within a tree' },
    ],
  });
}
