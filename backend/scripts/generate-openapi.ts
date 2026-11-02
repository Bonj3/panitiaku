import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  amountSchema,
  createTransactionSchema,
  rejectTransactionSchema,
  reverseTransactionSchema,
  updateTransactionSchema,
} from '../src/modules/finance/finance.validator.js';
import { createInvitationSchema } from '../src/modules/invitations/invitation.validator.js';
import { moveSchema } from '../src/modules/organization/organization.validator.js';

const schemas = {
  Amount: amountSchema,
  CreateTransaction: createTransactionSchema,
  UpdateTransaction: updateTransactionSchema,
  RejectTransaction: rejectTransactionSchema,
  ReverseTransaction: reverseTransactionSchema,
  CreateInvitation: createInvitationSchema,
  MoveMember: moveSchema,
};

const components = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })])
);

const document = {
  openapi: '3.1.0',
  info: {
    title: 'Event Committee API',
    version: '1.0.0',
    description: 'Minimal request-schema reference generated from backend Zod validators. See PROJECT.md §13 for endpoint behavior and response envelopes.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/events/{eventId}/transactions': {
      post: {
        summary: 'Create a draft transaction',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTransaction' } } } },
        responses: { '201': { description: 'Created' }, '422': { description: 'Validation error' } },
      },
    },
    '/events/{eventId}/invitations': {
      post: {
        summary: 'Create an invitation',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateInvitation' } } } },
        responses: { '201': { description: 'Created; plaintext token is returned once' }, '422': { description: 'Validation error' } },
      },
    },
    '/events/{eventId}/members/{memberId}/move': {
      post: {
        summary: 'Move a member in the organization tree',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MoveMember' } } } },
        responses: { '200': { description: 'Moved' }, '422': { description: 'Invalid hierarchy' } },
      },
    },
  },
  components: { schemas: components },
};

await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/openapi.json', import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
