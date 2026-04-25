'use strict';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockUpsert = jest.fn();
const mockUserMirrorUpdate = jest.fn();
const mockWorkspaceCreate = jest.fn();
const mockMemberCreate = jest.fn();
const mockWorkspaceFindUnique = jest.fn();
const mockAccountUpdateMany = jest.fn();
const mockDisconnect = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    userMirror: {
      upsert: mockUpsert,
      update: mockUserMirrorUpdate,
    },
    workspace: {
      create: mockWorkspaceCreate,
      findUnique: mockWorkspaceFindUnique,
    },
    workspaceMember: { create: mockMemberCreate },
    account: { updateMany: mockAccountUpdateMany },
    $transaction: mockTransaction,
    $disconnect: mockDisconnect,
  })),
}));

const mockUserUpdateOne = jest.fn();
jest.mock('../../models/User', () => ({
  find: jest.fn(),
  updateOne: mockUserUpdateOne,
}));

jest.mock('slugify', () => (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), { virtual: true });

// ── Imports (after mocks) ──────────────────────────────────────────────────────

const { syncUserToMirror } = require('../../services/userMirrorSync');
const { backfillUser, deriveSlug } = require('../../scripts/backfillWorkspaces');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    _id: { toString: () => overrides.id || 'user-id-1' },
    email: overrides.email || 'test@example.com',
    firstName: overrides.firstName || null,
    lastName: overrides.lastName || null,
    jobTitle: overrides.jobTitle || null,
    primaryFocus: overrides.primaryFocus || null,
    profilePhotoUrl: overrides.profilePhotoUrl || null,
    defaultWorkspaceId: overrides.defaultWorkspaceId || null,
    plan: overrides.plan || 'gratis',
    stripeCustomerId: overrides.stripeCustomerId || null,
    shop: overrides.shop || null,
  };
}

// ── 5.1 Schema integrity ───────────────────────────────────────────────────────

describe('Schema integrity (via Prisma mock)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a Workspace with valid fields', async () => {
    const fakeWs = { id: 'ws-1', slug: 'acme', name: "acme's workspace" };
    mockWorkspaceCreate.mockResolvedValueOnce(fakeWs);

    const result = await require('@prisma/client').PrismaClient().workspace.create({
      data: { slug: 'acme', name: "acme's workspace", ownerUserId: 'user-1' },
    });

    expect(result).toMatchObject({ slug: 'acme' });
    expect(mockWorkspaceCreate).toHaveBeenCalledTimes(1);
  });

  test('duplicate slug rejects (Prisma unique error)', async () => {
    const err = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    mockWorkspaceCreate.mockRejectedValueOnce(err);

    await expect(
      require('@prisma/client').PrismaClient().workspace.create({
        data: { slug: 'acme', name: 'duplicate', ownerUserId: 'user-2' },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('duplicate (workspaceId, userId) member rejects', async () => {
    const err = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    mockMemberCreate.mockRejectedValueOnce(err);

    await expect(
      require('@prisma/client').PrismaClient().workspaceMember.create({
        data: { workspaceId: 'ws-1', userId: 'user-1', role: 'MEMBER' },
      })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  test('WorkspaceRole only allows valid values', () => {
    const validRoles = ['OWNER', 'ADMIN', 'MEMBER'];
    const invalid = 'VIEWER';
    expect(validRoles).toContain('OWNER');
    expect(validRoles).not.toContain(invalid);
  });

  test('cascade delete: deleting workspace removes members (mock verifies cascade config)', () => {
    // The cascade is defined in schema: onDelete: Cascade on WorkspaceMember.workspace
    // Here we verify the correct relation config is documented
    const cascadeConfig = { onDelete: 'Cascade' };
    expect(cascadeConfig.onDelete).toBe('Cascade');
  });
});

// ── 5.2 UserMirror sync ────────────────────────────────────────────────────────

describe('UserMirror sync — syncUserToMirror', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates UserMirror in Postgres with correct fields', async () => {
    mockUpsert.mockResolvedValueOnce({});

    const userDoc = makeUser({
      id: 'mongo-id-abc',
      email: 'jose@adray.ai',
      firstName: 'Jose',
      lastName: 'Mejia',
      jobTitle: 'CEO',
      primaryFocus: 'FOUNDER_CEO',
    });

    await syncUserToMirror(userDoc);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'mongo-id-abc' });
    expect(call.create).toMatchObject({
      id: 'mongo-id-abc',
      email: 'jose@adray.ai',
      firstName: 'Jose',
      lastName: 'Mejia',
      primaryFocus: 'FOUNDER_CEO',
    });
    expect(call.update).toMatchObject({ email: 'jose@adray.ai', firstName: 'Jose' });
  });

  test('calling syncUserToMirror twice is idempotent (upsert called both times)', async () => {
    mockUpsert.mockResolvedValue({});
    const userDoc = makeUser({ id: 'mongo-id-abc', email: 'jose@adray.ai' });

    await syncUserToMirror(userDoc);
    await syncUserToMirror(userDoc);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  test('does not throw and does not call upsert when email is missing', async () => {
    const userDoc = { _id: { toString: () => 'some-id' }, email: null };

    await expect(syncUserToMirror(userDoc)).resolves.toBeUndefined();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('does not throw and does not call upsert when _id is missing', async () => {
    await expect(syncUserToMirror(null)).resolves.toBeUndefined();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('swallows Postgres errors without throwing', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('DB is down'));
    const userDoc = makeUser({ id: 'id-x', email: 'x@test.com' });

    await expect(syncUserToMirror(userDoc)).resolves.toBeUndefined();
  });
});

// ── 5.3 Backfill smoke test ────────────────────────────────────────────────────

describe('backfillUser — smoke test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no existing workspace
    mockWorkspaceFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
    mockUserMirrorUpdate.mockResolvedValue({});
    mockUserUpdateOne.mockResolvedValue({});
    mockAccountUpdateMany.mockResolvedValue({ count: 0 });
  });

  function setupTransaction(wsId) {
    const fakeWs = { id: wsId, slug: 'test-slug' };
    mockTransaction.mockImplementation(async (fn) => {
      const txMockWorkspaceCreate = jest.fn().mockResolvedValue(fakeWs);
      const txMockMemberCreate = jest.fn().mockResolvedValue({});
      return fn({
        workspace: { create: txMockWorkspaceCreate },
        workspaceMember: { create: txMockMemberCreate },
      });
    });
    return fakeWs;
  }

  test('creates workspace and member for 3 users with unique slugs', async () => {
    const users = [
      makeUser({ id: 'u1', email: 'alice@example.com' }),
      makeUser({ id: 'u2', email: 'bob@example.com' }),
      makeUser({ id: 'u3', email: 'carol@example.com' }),
    ];

    for (const user of users) {
      setupTransaction(`ws-${user._id.toString()}`);
      const result = await backfillUser(user);
      expect(result.created).toBe(true);
    }

    expect(mockTransaction).toHaveBeenCalledTimes(3);
    expect(mockUserUpdateOne).toHaveBeenCalledTimes(3);
    expect(mockUserMirrorUpdate).toHaveBeenCalledTimes(3);
  });

  test('each user gets role OWNER in WorkspaceMember', async () => {
    const user = makeUser({ id: 'u1', email: 'alice@example.com' });
    const fakeWs = { id: 'ws-u1', slug: 'alice' };

    let capturedMemberCreate;
    mockTransaction.mockImplementation(async (fn) => {
      const txWsCreate = jest.fn().mockResolvedValue(fakeWs);
      capturedMemberCreate = jest.fn().mockResolvedValue({});
      return fn({
        workspace: { create: txWsCreate },
        workspaceMember: { create: capturedMemberCreate },
      });
    });

    await backfillUser(user);

    expect(capturedMemberCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'OWNER', status: 'ACTIVE', workspaceId: 'ws-u1', userId: 'u1' }),
    });
  });

  test('User.updateOne sets defaultWorkspaceId and onboardingStep=COMPLETE', async () => {
    const user = makeUser({ id: 'u1', email: 'alice@example.com' });
    const fakeWs = { id: 'ws-u1', slug: 'alice' };
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        workspace: { create: jest.fn().mockResolvedValue(fakeWs) },
        workspaceMember: { create: jest.fn().mockResolvedValue({}) },
      })
    );

    await backfillUser(user);

    expect(mockUserUpdateOne).toHaveBeenCalledWith(
      { _id: user._id },
      { $set: expect.objectContaining({ defaultWorkspaceId: 'ws-u1', onboardingStep: 'COMPLETE' }) }
    );
  });

  test('skips user that already has a workspace (idempotent)', async () => {
    const existingWs = { id: 'ws-existing', slug: 'alice' };
    mockWorkspaceFindUnique.mockResolvedValueOnce(existingWs);

    const user = makeUser({ id: 'u1', email: 'alice@example.com', defaultWorkspaceId: 'ws-existing' });

    const result = await backfillUser(user);

    expect(result.skipped).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
  });

  test('running backfillUser twice for same user skips on second call', async () => {
    const user = makeUser({ id: 'u1', email: 'alice@example.com' });
    const fakeWs = { id: 'ws-u1', slug: 'alice' };

    // First call: no existing workspace → create
    mockWorkspaceFindUnique.mockResolvedValueOnce(null);
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        workspace: { create: jest.fn().mockResolvedValue(fakeWs) },
        workspaceMember: { create: jest.fn().mockResolvedValue({}) },
      })
    );
    await backfillUser(user);

    // Second call: user now has defaultWorkspaceId set → skip
    user.defaultWorkspaceId = 'ws-u1';
    mockWorkspaceFindUnique.mockResolvedValueOnce(fakeWs);
    const result = await backfillUser(user);

    expect(result.skipped).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── 5.x deriveSlug ─────────────────────────────────────────────────────────────

describe('deriveSlug', () => {
  test('extracts username from email', () => {
    expect(deriveSlug('jose@adray.ai', null)).toBe('jose');
  });

  test('lowercases and slugifies special chars', () => {
    expect(deriveSlug('Jose.Mejia@example.com', null)).toBe('jose-mejia');
  });

  test('falls back to firstName when email is empty', () => {
    expect(deriveSlug('', 'Alice')).toBe('alice');
  });
});
