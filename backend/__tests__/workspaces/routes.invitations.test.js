// backend/__tests__/workspaces/routes.invitations.test.js
'use strict';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const Workspace = require('../../models/Workspace');
const WorkspaceMember = require('../../models/WorkspaceMember');
const WorkspaceInvitation = require('../../models/WorkspaceInvitation');

let mongoServer;
let app;
let sentEmails;

function mockAuthApp() {
  const a = express();
  a.use(express.json());
  a.use(async (req, res, next) => {
    const id = req.headers['x-test-user-id'];
    if (id) {
      const u = await User.findById(id);
      if (u) {
        req.user = u;
        req.isAuthenticated = () => true;
      }
    }
    if (!req.isAuthenticated) req.isAuthenticated = () => false;
    next();
  });
  return a;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  // Mock auth.
  jest.doMock('../../auth', () => ({
    ensureAuthenticated: (req, res, next) => {
      if (req.user) return next();
      return res.status(401).json({ error: 'NOT_AUTHENTICATED_TEST' });
    },
  }));

  // Mock email service (no llamar a Resend).
  sentEmails = [];
  jest.doMock('../../services/emailService', () => ({
    sendWorkspaceInvitationEmail: jest.fn(async (payload) => {
      sentEmails.push(payload);
      return { sent: true, id: 'mock-' + Date.now() };
    }),
    renderInvitationHtml: () => '<html></html>',
  }));

  // eslint-disable-next-line global-require
  const workspacesRoutes = require('../../routes/workspaces');
  // eslint-disable-next-line global-require
  const invitationsRoutes = require('../../routes/invitations');

  app = mockAuthApp();
  app.use(workspacesRoutes);
  app.use(invitationsRoutes);
}, 60000);

afterAll(async () => {
  jest.dontMock('../../auth');
  jest.dontMock('../../services/emailService');
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
  await Workspace.deleteMany({});
  await WorkspaceMember.deleteMany({});
  await WorkspaceInvitation.deleteMany({});
  sentEmails.length = 0;
});

async function createOwner(email = 'owner@example.com') {
  const u = await User.create({ email, firstName: 'Owner' });
  const ws = await Workspace.create({ slug: 'ws-1', name: 'Test WS', ownerUserId: u._id });
  await WorkspaceMember.create({
    workspaceId: ws._id, userId: u._id, role: 'OWNER', status: 'ACTIVE',
  });
  return { user: u, workspace: ws };
}

describe('POST /api/workspaces/:id/invitations', () => {
  test('Owner crea invitación y se envía email', async () => {
    const { user, workspace } = await createOwner();
    const res = await request(app)
      .post(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(user._id))
      .send({ email: 'newbie@example.com', role: 'MEMBER' });
    expect(res.status).toBe(201);
    expect(res.body.invitation.email).toBe('newbie@example.com');
    expect(res.body.invitation.role).toBe('MEMBER');
    expect(res.body.emailDelivered).toBe(true);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].toEmail).toBe('newbie@example.com');
  });

  test('400 si email inválido', async () => {
    const { user, workspace } = await createOwner();
    const res = await request(app)
      .post(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(user._id))
      .send({ email: 'no-es-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('EMAIL_INVALID');
  });

  test('400 si role no es ADMIN ni MEMBER', async () => {
    const { user, workspace } = await createOwner();
    const res = await request(app)
      .post(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(user._id))
      .send({ email: 'x@example.com', role: 'OWNER' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ROLE');
  });

  test('409 si email ya es miembro', async () => {
    const { user, workspace } = await createOwner();
    const member = await User.create({ email: 'member@example.com' });
    await WorkspaceMember.create({
      workspaceId: workspace._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .post(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(user._id))
      .send({ email: 'member@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_A_MEMBER');
  });

  test('409 si ya tiene invitación pendiente', async () => {
    const { user, workspace } = await createOwner();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'pending@example.com',
      role: 'MEMBER',
      tokenHash: 'h1',
      invitedBy: user._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    const res = await request(app)
      .post(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(user._id))
      .send({ email: 'pending@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INVITATION_ALREADY_PENDING');
  });

  test('Member NO puede crear invitación', async () => {
    const { workspace } = await createOwner();
    const member = await User.create({ email: 'member@example.com' });
    await WorkspaceMember.create({
      workspaceId: workspace._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .post(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(member._id))
      .send({ email: 'someone@example.com' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/workspaces/:id/invitations', () => {
  test('lista invitaciones pendientes', async () => {
    const { user, workspace } = await createOwner();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'a@example.com',
      role: 'MEMBER',
      tokenHash: 'h1',
      invitedBy: user._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'expired@example.com',
      role: 'MEMBER',
      tokenHash: 'h2',
      invitedBy: user._id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get(`/api/workspaces/${workspace._id}/invitations`)
      .set('x-test-user-id', String(user._id));
    expect(res.status).toBe(200);
    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.invitations[0].email).toBe('a@example.com');
    expect(res.body.invitations[0].tokenHash).toBeUndefined(); // no debe filtrarse
  });
});

describe('DELETE /api/workspaces/:id/invitations/:invitationId', () => {
  test('Owner revoca invitación', async () => {
    const { user, workspace } = await createOwner();
    const inv = await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'x@example.com',
      role: 'MEMBER',
      tokenHash: 'h1',
      invitedBy: user._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    const res = await request(app)
      .delete(`/api/workspaces/${workspace._id}/invitations/${inv._id}`)
      .set('x-test-user-id', String(user._id));
    expect(res.status).toBe(200);
    const updated = await WorkspaceInvitation.findById(inv._id);
    expect(updated.revokedAt).not.toBeNull();
  });

  test('400 si ya estaba revocada', async () => {
    const { user, workspace } = await createOwner();
    const inv = await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'x@example.com',
      role: 'MEMBER',
      tokenHash: 'h1',
      invitedBy: user._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
      revokedAt: new Date(),
    });
    const res = await request(app)
      .delete(`/api/workspaces/${workspace._id}/invitations/${inv._id}`)
      .set('x-test-user-id', String(user._id));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/invitations/:token/accept', () => {
  const crypto = require('crypto');

  function makeToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, tokenHash };
  }

  test('happy path: acepta y crea WorkspaceMember', async () => {
    const { user: owner, workspace } = await createOwner();
    const invitee = await User.create({ email: 'invitee@example.com' });
    const { token, tokenHash } = makeToken();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });

    const res = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set('x-test-user-id', String(invitee._id));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const member = await WorkspaceMember.findOne({
      workspaceId: workspace._id, userId: invitee._id,
    });
    expect(member).toBeTruthy();
    expect(member.role).toBe('MEMBER');
    expect(member.status).toBe('ACTIVE');

    const updatedInvitation = await WorkspaceInvitation.findOne({ tokenHash });
    expect(updatedInvitation.acceptedAt).not.toBeNull();

    const updatedUser = await User.findById(invitee._id);
    expect(String(updatedUser.lastActiveWorkspaceId)).toBe(String(workspace._id));
    expect(String(updatedUser.defaultWorkspaceId)).toBe(String(workspace._id));
  });

  test('401 NEEDS_LOGIN si no autenticado', async () => {
    const { token } = makeToken();
    const res = await request(app).post(`/api/invitations/${token}/accept`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NEEDS_LOGIN');
  });

  test('404 si token inválido', async () => {
    const u = await User.create({ email: 'x@example.com' });
    const res = await request(app)
      .post('/api/invitations/no-existe/accept')
      .set('x-test-user-id', String(u._id));
    expect(res.status).toBe(404);
  });

  test('410 INVITATION_EXPIRED', async () => {
    const { user: owner, workspace } = await createOwner();
    const invitee = await User.create({ email: 'invitee@example.com' });
    const { token, tokenHash } = makeToken();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set('x-test-user-id', String(invitee._id));
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('INVITATION_EXPIRED');
  });

  test('410 INVITATION_REVOKED', async () => {
    const { user: owner, workspace } = await createOwner();
    const invitee = await User.create({ email: 'invitee@example.com' });
    const { token, tokenHash } = makeToken();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
      revokedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set('x-test-user-id', String(invitee._id));
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('INVITATION_REVOKED');
  });

  test('410 INVITATION_ALREADY_ACCEPTED si ya se aceptó antes', async () => {
    const { user: owner, workspace } = await createOwner();
    const invitee = await User.create({ email: 'invitee@example.com' });
    const { token, tokenHash } = makeToken();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
      acceptedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set('x-test-user-id', String(invitee._id));
    expect(res.status).toBe(410);
  });

  test('403 EMAIL_MISMATCH si user logueado tiene otro email', async () => {
    const { user: owner, workspace } = await createOwner();
    const wrongUser = await User.create({ email: 'someone-else@example.com' });
    const { token, tokenHash } = makeToken();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    const res = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set('x-test-user-id', String(wrongUser._id));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('EMAIL_MISMATCH');
  });

  test('409 ALREADY_A_MEMBER si ya está dentro', async () => {
    const { user: owner, workspace } = await createOwner();
    const invitee = await User.create({ email: 'invitee@example.com' });
    await WorkspaceMember.create({
      workspaceId: workspace._id, userId: invitee._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const { token, tokenHash } = makeToken();
    await WorkspaceInvitation.create({
      workspaceId: workspace._id,
      email: 'invitee@example.com',
      role: 'MEMBER',
      tokenHash,
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    const res = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .set('x-test-user-id', String(invitee._id));
    expect(res.status).toBe(409);
  });
});
