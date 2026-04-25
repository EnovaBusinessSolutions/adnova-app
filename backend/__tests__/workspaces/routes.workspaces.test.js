// backend/__tests__/workspaces/routes.workspaces.test.js
'use strict';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');
const Workspace = require('../../models/Workspace');
const WorkspaceMember = require('../../models/WorkspaceMember');

let mongoServer;
let app;

// Mock de auth: inyecta req.user desde header X-Test-User-Id.
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

  // Mockear ensureAuthenticated antes de cargar el router.
  jest.doMock('../../auth', () => ({
    ensureAuthenticated: (req, res, next) => {
      if (req.user) return next();
      return res.status(401).json({ error: 'NOT_AUTHENTICATED_TEST' });
    },
  }));

  // eslint-disable-next-line global-require
  const workspacesRoutes = require('../../routes/workspaces');
  // eslint-disable-next-line global-require
  const meRoutes = require('../../routes/me');

  app = mockAuthApp();
  app.use(workspacesRoutes);
  app.use(meRoutes);
}, 60000);

afterAll(async () => {
  jest.dontMock('../../auth');
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
  await Workspace.deleteMany({});
  await WorkspaceMember.deleteMany({});
});

async function createUser(email = 'a@example.com') {
  return User.create({ email });
}

async function createWorkspaceFor(user, slug = 'ws-1') {
  const ws = await Workspace.create({ slug, name: 'Test', ownerUserId: user._id });
  const m = await WorkspaceMember.create({
    workspaceId: ws._id, userId: user._id, role: 'OWNER', status: 'ACTIVE',
  });
  return { ws, m };
}

describe('POST /api/workspaces', () => {
  test('crea workspace con name', async () => {
    const u = await createUser();
    const res = await request(app)
      .post('/api/workspaces')
      .set('x-test-user-id', String(u._id))
      .send({ name: 'My Workspace' });
    expect(res.status).toBe(201);
    expect(res.body.workspace.slug).toBe('my-workspace');
    expect(res.body.workspace.name).toBe('My Workspace');
    expect(res.body.membership.role).toBe('OWNER');
  });

  test('400 si falta name', async () => {
    const u = await createUser();
    const res = await request(app)
      .post('/api/workspaces')
      .set('x-test-user-id', String(u._id))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NAME_REQUIRED');
  });

  test('409 si slug está tomado', async () => {
    const u = await createUser();
    await createWorkspaceFor(u, 'my-ws');
    const res = await request(app)
      .post('/api/workspaces')
      .set('x-test-user-id', String(u._id))
      .send({ name: 'Otro', slug: 'my-ws' });
    expect(res.status).toBe(409);
  });

  test('401 sin auth', async () => {
    const res = await request(app).post('/api/workspaces').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  test('genera slug único cuando ya existe el base', async () => {
    const u = await createUser();
    await createWorkspaceFor(u, 'foo');
    const res = await request(app)
      .post('/api/workspaces')
      .set('x-test-user-id', String(u._id))
      .send({ name: 'Foo' });
    expect(res.status).toBe(201);
    expect(res.body.workspace.slug).toBe('foo-2');
  });
});

describe('GET /api/me/workspaces', () => {
  test('lista los workspaces del user con role', async () => {
    const u = await createUser();
    await createWorkspaceFor(u, 'ws-a');
    await createWorkspaceFor(u, 'ws-b');
    const res = await request(app)
      .get('/api/me/workspaces')
      .set('x-test-user-id', String(u._id));
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(2);
    expect(res.body.workspaces.every((w) => w.role === 'OWNER')).toBe(true);
  });

  test('no incluye workspaces soft-deleted', async () => {
    const u = await createUser();
    const { ws } = await createWorkspaceFor(u, 'ws-a');
    await Workspace.updateOne({ _id: ws._id }, { $set: { deletedAt: new Date() } });
    const res = await request(app)
      .get('/api/me/workspaces')
      .set('x-test-user-id', String(u._id));
    expect(res.body.workspaces).toHaveLength(0);
  });
});

describe('PUT /api/me/active-workspace', () => {
  test('cambia lastActiveWorkspaceId', async () => {
    const u = await createUser();
    const { ws } = await createWorkspaceFor(u, 'ws-a');
    const res = await request(app)
      .put('/api/me/active-workspace')
      .set('x-test-user-id', String(u._id))
      .send({ workspaceId: String(ws._id) });
    expect(res.status).toBe(200);
    const updated = await User.findById(u._id);
    expect(String(updated.lastActiveWorkspaceId)).toBe(String(ws._id));
  });

  test('403 si no es miembro', async () => {
    const owner = await createUser('owner@example.com');
    const stranger = await createUser('stranger@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    const res = await request(app)
      .put('/api/me/active-workspace')
      .set('x-test-user-id', String(stranger._id))
      .send({ workspaceId: String(ws._id) });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/workspaces/:id', () => {
  test('200 si miembro', async () => {
    const u = await createUser();
    const { ws } = await createWorkspaceFor(u, 'ws-a');
    const res = await request(app)
      .get(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(u._id));
    expect(res.status).toBe(200);
    expect(res.body.workspace.slug).toBe('ws-a');
  });

  test('403 si no es miembro', async () => {
    const owner = await createUser('owner@example.com');
    const stranger = await createUser('stranger@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    const res = await request(app)
      .get(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(stranger._id));
    expect(res.status).toBe(403);
  });

  test('404 si workspace no existe', async () => {
    const u = await createUser();
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/workspaces/${fakeId}`)
      .set('x-test-user-id', String(u._id));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/workspaces/:id', () => {
  test('Owner puede cambiar nombre', async () => {
    const u = await createUser();
    const { ws } = await createWorkspaceFor(u, 'ws-a');
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(u._id))
      .send({ name: 'Nuevo Nombre' });
    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe('Nuevo Nombre');
  });

  test('Member NO puede cambiar nombre', async () => {
    const owner = await createUser('owner@example.com');
    const member = await createUser('member@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(member._id))
      .send({ name: 'Hack' });
    expect(res.status).toBe(403);
  });

  test('Admin NO puede cambiar slug (solo Owner)', async () => {
    const owner = await createUser('owner@example.com');
    const admin = await createUser('admin@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: admin._id, role: 'ADMIN', status: 'ACTIVE',
    });
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(admin._id))
      .send({ slug: 'new-slug' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/workspaces/:id', () => {
  test('Owner puede soft-delete', async () => {
    const u = await createUser();
    const { ws } = await createWorkspaceFor(u, 'ws-a');
    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(u._id));
    expect(res.status).toBe(200);
    const found = await Workspace.findById(ws._id);
    expect(found.deletedAt).not.toBeNull();
  });

  test('Admin NO puede borrar', async () => {
    const owner = await createUser('owner@example.com');
    const admin = await createUser('admin@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: admin._id, role: 'ADMIN', status: 'ACTIVE',
    });
    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}`)
      .set('x-test-user-id', String(admin._id));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/workspaces/:id/transfer-ownership', () => {
  test('Owner transfiere a Admin existente', async () => {
    const owner = await createUser('owner@example.com');
    const target = await createUser('target@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: target._id, role: 'ADMIN', status: 'ACTIVE',
    });

    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/transfer-ownership`)
      .set('x-test-user-id', String(owner._id))
      .send({ targetUserId: String(target._id) });
    expect(res.status).toBe(200);

    const updated = await Workspace.findById(ws._id);
    expect(String(updated.ownerUserId)).toBe(String(target._id));

    const ownerMembership = await WorkspaceMember.findOne({ workspaceId: ws._id, userId: owner._id });
    expect(ownerMembership.role).toBe('ADMIN');

    const targetMembership = await WorkspaceMember.findOne({ workspaceId: ws._id, userId: target._id });
    expect(targetMembership.role).toBe('OWNER');
  });

  test('400 si target es self', async () => {
    const owner = await createUser('owner@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/transfer-ownership`)
      .set('x-test-user-id', String(owner._id))
      .send({ targetUserId: String(owner._id) });
    expect(res.status).toBe(400);
  });

  test('404 si target no es miembro', async () => {
    const owner = await createUser('owner@example.com');
    const stranger = await createUser('stranger@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    const res = await request(app)
      .post(`/api/workspaces/${ws._id}/transfer-ownership`)
      .set('x-test-user-id', String(owner._id))
      .send({ targetUserId: String(stranger._id) });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/workspaces/:id/members', () => {
  test('Member puede ver lista', async () => {
    const owner = await createUser('owner@example.com');
    const member = await createUser('member@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .get(`/api/workspaces/${ws._id}/members`)
      .set('x-test-user-id', String(member._id));
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
  });
});

describe('PATCH /api/workspaces/:id/members/:userId', () => {
  test('Owner cambia Member a Admin', async () => {
    const owner = await createUser('owner@example.com');
    const member = await createUser('member@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/${member._id}`)
      .set('x-test-user-id', String(owner._id))
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe('ADMIN');
  });

  test('400 si trata de asignar OWNER por aquí', async () => {
    const owner = await createUser('owner@example.com');
    const member = await createUser('member@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/${member._id}`)
      .set('x-test-user-id', String(owner._id))
      .send({ role: 'OWNER' });
    expect(res.status).toBe(400);
  });

  test('Admin no puede tocar al Owner', async () => {
    const owner = await createUser('owner@example.com');
    const admin = await createUser('admin@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: admin._id, role: 'ADMIN', status: 'ACTIVE',
    });
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/${owner._id}`)
      .set('x-test-user-id', String(admin._id))
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(403);
  });

  test('400 si trata de cambiarse a sí mismo', async () => {
    const owner = await createUser('owner@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    const res = await request(app)
      .patch(`/api/workspaces/${ws._id}/members/${owner._id}`)
      .set('x-test-user-id', String(owner._id))
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/workspaces/:id/members/:userId', () => {
  test('Owner puede remover Member', async () => {
    const owner = await createUser('owner@example.com');
    const member = await createUser('member@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${member._id}`)
      .set('x-test-user-id', String(owner._id));
    expect(res.status).toBe(200);
    const found = await WorkspaceMember.findOne({ workspaceId: ws._id, userId: member._id });
    expect(found).toBeNull();
  });

  test('Self-leave permitido para Member', async () => {
    const owner = await createUser('owner@example.com');
    const member = await createUser('member@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    await WorkspaceMember.create({
      workspaceId: ws._id, userId: member._id, role: 'MEMBER', status: 'ACTIVE',
    });
    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${member._id}`)
      .set('x-test-user-id', String(member._id));
    expect(res.status).toBe(200);
  });

  test('Owner único NO puede ser removido (CANNOT_REMOVE_LAST_OWNER)', async () => {
    const owner = await createUser('owner@example.com');
    const { ws } = await createWorkspaceFor(owner, 'ws-a');
    const res = await request(app)
      .delete(`/api/workspaces/${ws._id}/members/${owner._id}`)
      .set('x-test-user-id', String(owner._id));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CANNOT_REMOVE_LAST_OWNER');
  });
});
