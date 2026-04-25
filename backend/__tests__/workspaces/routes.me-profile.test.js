'use strict';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../../models/User');

let mongoServer;
let app;

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

  jest.doMock('../../auth', () => ({
    ensureAuthenticated: (req, res, next) => {
      if (req.user) return next();
      return res.status(401).json({ error: 'NOT_AUTHENTICATED_TEST' });
    },
  }));

  // eslint-disable-next-line global-require
  const meRoutes = require('../../routes/me');
  app = mockAuthApp();
  app.use(meRoutes);
}, 60000);

afterAll(async () => {
  jest.dontMock('../../auth');
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

describe('PATCH /api/me/profile', () => {
  test('actualiza firstName y lastName', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ firstName: 'Ana', lastName: 'García' });
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Ana');
    expect(res.body.user.lastName).toBe('García');
  });

  test('actualiza onboardingStep', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ onboardingStep: 'PROFILE_COMPLETE' });
    expect(res.status).toBe(200);
    expect(res.body.user.onboardingStep).toBe('PROFILE_COMPLETE');
  });

  test('400 si onboardingStep es inválido', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ onboardingStep: 'WEIRD_STATE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ONBOARDING_STEP');
  });

  test('400 si primaryFocus es inválido', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ primaryFocus: 'CFO' });
    expect(res.status).toBe(400);
  });

  test('400 si firstName es muy largo', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ firstName: 'a'.repeat(33) });
    expect(res.status).toBe(400);
  });

  test('400 si body vacío', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_UPDATES_PROVIDED');
  });

  test('401 sin auth', async () => {
    const res = await request(app)
      .patch('/api/me/profile')
      .send({ firstName: 'X' });
    expect(res.status).toBe(401);
  });

  test('NO toca campos no enviados', async () => {
    const u = await User.create({ email: 'a@example.com', firstName: 'Inicial', lastName: 'Apellido' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ firstName: 'Cambiado' });
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Cambiado');
    expect(res.body.user.lastName).toBe('Apellido');
  });

  test('actualiza primaryFocus a valor válido', async () => {
    const u = await User.create({ email: 'a@example.com' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ primaryFocus: 'HEAD_OF_GROWTH' });
    expect(res.status).toBe(200);
    expect(res.body.user.primaryFocus).toBe('HEAD_OF_GROWTH');
  });

  test('actualiza primaryFocus a null', async () => {
    const u = await User.create({ email: 'a@example.com', primaryFocus: 'AGENCY' });
    const res = await request(app)
      .patch('/api/me/profile')
      .set('x-test-user-id', String(u._id))
      .send({ primaryFocus: null });
    expect(res.status).toBe(200);
    expect(res.body.user.primaryFocus).toBeNull();
  });
});
