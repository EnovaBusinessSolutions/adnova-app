// backend/__tests__/workspaces/middlewares.test.js
'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const Workspace = require('../../models/Workspace');
const WorkspaceMember = require('../../models/WorkspaceMember');

const resolveWorkspace = require('../../middlewares/resolveWorkspace');
const requirePermission = require('../../middlewares/requirePermission');

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
  await User.deleteMany({});
  await Workspace.deleteMany({});
  await WorkspaceMember.deleteMany({});
});

/**
 * Helpers para mockear req/res/next.
 */
function makeReq(overrides = {}) {
  return {
    headers: {},
    user: null,
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function makeNext() {
  const fn = jest.fn();
  return fn;
}

describe('resolveWorkspace middleware', () => {
  test('401 si req.user no está', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'NOT_AUTHENTICATED' });
    expect(next).not.toHaveBeenCalled();
  });

  test('400 NO_WORKSPACE_RESOLVED si no hay header ni defaults', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const req = makeReq({ user });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'NO_WORKSPACE_RESOLVED' });
  });

  test('400 INVALID_WORKSPACE_ID si el header no es ObjectId', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const req = makeReq({ user, headers: { 'x-workspace-id': 'not-an-id' } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_WORKSPACE_ID' });
  });

  test('404 WORKSPACE_NOT_FOUND si workspace no existe', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const fakeId = new mongoose.Types.ObjectId();
    const req = makeReq({ user, headers: { 'x-workspace-id': String(fakeId) } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'WORKSPACE_NOT_FOUND' });
  });

  test('404 WORKSPACE_NOT_FOUND si workspace está soft-deleted', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({
      slug: 'ws-1', name: 'X', ownerUserId: user._id, deletedAt: new Date(),
    });
    const req = makeReq({ user, headers: { 'x-workspace-id': String(ws._id) } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(404);
  });

  test('403 NOT_A_MEMBER si user no es miembro', async () => {
    const owner = await User.create({ email: 'owner@example.com' });
    const stranger = await User.create({ email: 'stranger@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: owner._id });
    await WorkspaceMember.create({ workspaceId: ws._id, userId: owner._id, role: 'OWNER' });

    const req = makeReq({ user: stranger, headers: { 'x-workspace-id': String(ws._id) } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'NOT_A_MEMBER' });
  });

  test('403 NOT_A_MEMBER si membership está SUSPENDED', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: user._id, role: 'MEMBER', status: 'SUSPENDED',
    });

    const req = makeReq({ user, headers: { 'x-workspace-id': String(ws._id) } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  test('inyecta workspace y membership y llama next() en happy path', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const ws = await Workspace.create({ slug: 'ws-1', name: 'X', ownerUserId: user._id });
    const member = await WorkspaceMember.create({
      workspaceId: ws._id, userId: user._id, role: 'OWNER', status: 'ACTIVE',
    });

    const req = makeReq({ user, headers: { 'x-workspace-id': String(ws._id) } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.workspaceId).toBe(String(ws._id));
    expect(req.workspace._id.toString()).toBe(String(ws._id));
    expect(req.workspaceMembership._id.toString()).toBe(String(member._id));
    expect(req.workspaceMembership.role).toBe('OWNER');
  });

  test('usa lastActiveWorkspaceId si no hay header', async () => {
    const ws = await Workspace.create({
      slug: 'ws-1', name: 'X', ownerUserId: new mongoose.Types.ObjectId(),
    });
    const user = await User.create({
      email: 'a@example.com',
      lastActiveWorkspaceId: ws._id,
    });
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: user._id, role: 'MEMBER',
    });

    const req = makeReq({ user });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.workspaceId).toBe(String(ws._id));
  });

  test('usa defaultWorkspaceId si no hay header ni lastActive', async () => {
    const ws = await Workspace.create({
      slug: 'ws-1', name: 'X', ownerUserId: new mongoose.Types.ObjectId(),
    });
    const user = await User.create({
      email: 'a@example.com',
      defaultWorkspaceId: ws._id,
    });
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: user._id, role: 'MEMBER',
    });

    const req = makeReq({ user });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('header tiene precedencia sobre defaults', async () => {
    const user = await User.create({ email: 'a@example.com' });
    const wsHeader = await Workspace.create({
      slug: 'ws-h', name: 'H', ownerUserId: user._id,
    });
    const wsDefault = await Workspace.create({
      slug: 'ws-d', name: 'D', ownerUserId: user._id,
    });
    await WorkspaceMember.create({ workspaceId: wsHeader._id, userId: user._id, role: 'OWNER' });
    await WorkspaceMember.create({ workspaceId: wsDefault._id, userId: user._id, role: 'OWNER' });
    user.defaultWorkspaceId = wsDefault._id;
    await user.save();

    const req = makeReq({ user, headers: { 'x-workspace-id': String(wsHeader._id) } });
    const res = makeRes();
    const next = makeNext();

    await resolveWorkspace(req, res, next);
    expect(req.workspaceId).toBe(String(wsHeader._id));
  });
});

describe('requirePermission middleware', () => {
  test('throws en setup si la acción es desconocida', () => {
    expect(() => requirePermission('foo.bar')).toThrow(/unknown action/);
  });

  test('throws en setup si action no es string', () => {
    expect(() => requirePermission()).toThrow();
    expect(() => requirePermission('')).toThrow();
    expect(() => requirePermission(123)).toThrow();
  });

  test('500 si no hay req.workspaceMembership', () => {
    const mw = requirePermission('members.invite');
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('INTERNAL');
    expect(next).not.toHaveBeenCalled();
  });

  test('403 si rol no tiene el permiso', () => {
    const mw = requirePermission('workspace.delete');
    const req = makeReq({ workspaceMembership: { role: 'ADMIN' } });
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('INSUFFICIENT_PERMISSION');
    expect(res.body.action).toBe('workspace.delete');
    expect(res.body.userRole).toBe('ADMIN');
    expect(next).not.toHaveBeenCalled();
  });

  test('next() si el rol tiene el permiso', () => {
    const mw = requirePermission('members.invite');
    const req = makeReq({ workspaceMembership: { role: 'OWNER' } });
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('OWNER pasa cualquier acción declarada', () => {
    const { PERMISSIONS } = require('../../config/permissions');
    for (const action of Object.keys(PERMISSIONS)) {
      const mw = requirePermission(action);
      const req = makeReq({ workspaceMembership: { role: 'OWNER' } });
      const res = makeRes();
      const next = makeNext();
      mw(req, res, next);
      expect(next).toHaveBeenCalled();
    }
  });

  test('MEMBER no puede dashboard.connect', () => {
    const mw = requirePermission('dashboard.connect');
    const req = makeReq({ workspaceMembership: { role: 'MEMBER' } });
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  test('MEMBER puede mcp.generate', () => {
    const mw = requirePermission('mcp.generate');
    const req = makeReq({ workspaceMembership: { role: 'MEMBER' } });
    const res = makeRes();
    const next = makeNext();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
