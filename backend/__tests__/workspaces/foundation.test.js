// backend/__tests__/workspaces/foundation.test.js
'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const Workspace = require('../../models/Workspace');
const WorkspaceMember = require('../../models/WorkspaceMember');
const WorkspaceInvitation = require('../../models/WorkspaceInvitation');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Workspace.deleteMany({});
  await WorkspaceMember.deleteMany({});
  await WorkspaceInvitation.deleteMany({});
  await User.deleteMany({});
});

describe('Workspace model', () => {
  test('crea un workspace con campos válidos', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({
      slug: 'mi-ws',
      name: 'Mi Workspace',
      ownerUserId: user._id,
    });
    expect(ws.slug).toBe('mi-ws');
    expect(ws.icon).toBe('SHOPPING_BAG');
    expect(ws.plan).toBe('gratis');
    expect(ws.onboardingComplete).toBe(false);
  });

  test('falla si slug está duplicado', async () => {
    const user = await User.create({ email: 'a@example.com' });
    await Workspace.create({ slug: 'unico', name: 'A', ownerUserId: user._id });
    await expect(
      Workspace.create({ slug: 'unico', name: 'B', ownerUserId: user._id })
    ).rejects.toThrow();
  });

  test('falla si slug no cumple regex', async () => {
    const user = await User.create({ email: 'a@example.com' });
    await expect(
      Workspace.create({ slug: 'INVALID SLUG!', name: 'X', ownerUserId: user._id })
    ).rejects.toThrow();
  });

  test('falla si icon es inválido', async () => {
    const user = await User.create({ email: 'a@example.com' });
    await expect(
      Workspace.create({ slug: 'ws-1', name: 'X', icon: 'INVALID', ownerUserId: user._id })
    ).rejects.toThrow();
  });
});

describe('WorkspaceMember model', () => {
  test('crea un member con role default MEMBER y status ACTIVE', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    const member = await WorkspaceMember.create({ workspaceId: ws._id, userId: user._id });
    expect(member.role).toBe('MEMBER');
    expect(member.status).toBe('ACTIVE');
  });

  test('falla si role no es OWNER/ADMIN/MEMBER', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    await expect(
      WorkspaceMember.create({ workspaceId: ws._id, userId: user._id, role: 'VIEWER' })
    ).rejects.toThrow();
  });

  test('no permite duplicar (workspaceId, userId)', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    await WorkspaceMember.create({ workspaceId: ws._id, userId: user._id, role: 'OWNER' });
    await expect(
      WorkspaceMember.create({ workspaceId: ws._id, userId: user._id, role: 'ADMIN' })
    ).rejects.toThrow();
  });
});

describe('WorkspaceInvitation model', () => {
  test('crea una invitación válida', async () => {
    const user = await User.create({ email: 'inviter@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    const inv = await WorkspaceInvitation.create({
      workspaceId: ws._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash: 'hash123',
      invitedBy: user._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(inv.email).toBe('invitee@example.com');
    expect(inv.acceptedAt).toBeNull();
  });

  test('falla si role es OWNER (no invitable)', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    await expect(
      WorkspaceInvitation.create({
        workspaceId: ws._id,
        email: 'b@example.com',
        role: 'OWNER',
        tokenHash: 'h',
        invitedBy: user._id,
        expiresAt: new Date(),
      })
    ).rejects.toThrow();
  });

  test('falla si tokenHash está duplicado', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    await WorkspaceInvitation.create({
      workspaceId: ws._id,
      email: 'b@example.com',
      tokenHash: 'duplicate-hash',
      invitedBy: user._id,
      expiresAt: new Date(),
    });
    await expect(
      WorkspaceInvitation.create({
        workspaceId: ws._id,
        email: 'c@example.com',
        tokenHash: 'duplicate-hash',
        invitedBy: user._id,
        expiresAt: new Date(),
      })
    ).rejects.toThrow();
  });
});

describe('User extension', () => {
  test('crea un user con los campos nuevos en defaults', async () => {
    const user = await User.create({ email: 'a@example.com' });
    expect(user.firstName).toBe('');
    expect(user.lastName).toBe('');
    expect(user.primaryFocus).toBeNull();
    expect(user.onboardingStep).toBe('NONE');
    expect(user.defaultWorkspaceId).toBeNull();
  });

  test('falla si onboardingStep es inválido', async () => {
    await expect(
      User.create({ email: 'a@example.com', onboardingStep: 'WEIRD' })
    ).rejects.toThrow();
  });

  test('falla si primaryFocus es inválido', async () => {
    await expect(
      User.create({ email: 'a@example.com', primaryFocus: 'WEIRD' })
    ).rejects.toThrow();
  });

  test('NO rompe el campo onboardingComplete existente', async () => {
    const user = await User.create({ email: 'a@example.com', onboardingComplete: true });
    expect(user.onboardingComplete).toBe(true);
  });
});

describe('Backfill (smoke test)', () => {
  // Usaremos require dinámico para el backfill, evitando que importe dotenv.
  test('crea workspace personal por user existente con role OWNER', async () => {
    const u1 = await User.create({ email: 'alice@example.com', firstName: 'Alice' });
    const u2 = await User.create({ email: 'bob@example.com' });

    // Inline backfill: replicar la lógica clave sin invocar el script entero
    // (el script entero llama a process.exit y conecta a Mongo distinto).
    const slugify = require('slugify');
    for (const user of [u1, u2]) {
      const baseSlug = slugify(user.email.split('@')[0], { lower: true, strict: true });
      const ws = await Workspace.create({
        slug: baseSlug,
        name: `${user.firstName || user.email.split('@')[0]}'s workspace`,
        ownerUserId: user._id,
        onboardingComplete: true,
      });
      await WorkspaceMember.create({
        workspaceId: ws._id,
        userId: user._id,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      await User.updateOne(
        { _id: user._id },
        { $set: { defaultWorkspaceId: ws._id, lastActiveWorkspaceId: ws._id, onboardingStep: 'COMPLETE' } }
      );
    }

    const wsCount = await Workspace.countDocuments({});
    const ownerCount = await WorkspaceMember.countDocuments({ role: 'OWNER' });
    expect(wsCount).toBe(2);
    expect(ownerCount).toBe(2);

    const aliceUpdated = await User.findById(u1._id);
    expect(aliceUpdated.defaultWorkspaceId).not.toBeNull();
    expect(aliceUpdated.onboardingStep).toBe('COMPLETE');
  });
});
