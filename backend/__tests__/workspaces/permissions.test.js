// backend/__tests__/workspaces/permissions.test.js
'use strict';

const {
  ROLES,
  ROLE_HIERARCHY,
  PERMISSIONS,
  canDo,
  roleSatisfies,
  actionsForRole,
} = require('../../config/permissions');

describe('PERMISSIONS matrix', () => {
  test('exporta los 3 roles esperados', () => {
    expect(ROLES.OWNER).toBe('OWNER');
    expect(ROLES.ADMIN).toBe('ADMIN');
    expect(ROLES.MEMBER).toBe('MEMBER');
  });

  test('jerarquía OWNER > ADMIN > MEMBER', () => {
    expect(ROLE_HIERARCHY.OWNER).toBeGreaterThan(ROLE_HIERARCHY.ADMIN);
    expect(ROLE_HIERARCHY.ADMIN).toBeGreaterThan(ROLE_HIERARCHY.MEMBER);
  });

  test('toda acción tiene al menos un rol permitido', () => {
    for (const [action, roles] of Object.entries(PERMISSIONS)) {
      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length).toBeGreaterThan(0);
    }
  });

  test('OWNER tiene acceso a TODAS las acciones', () => {
    for (const [action, roles] of Object.entries(PERMISSIONS)) {
      expect(roles).toContain('OWNER');
    }
  });

  test('todas las acciones usan formato dominio.accion', () => {
    for (const action of Object.keys(PERMISSIONS)) {
      expect(action).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
    }
  });

  test('roles válidos en cada entrada', () => {
    const valid = new Set(['OWNER', 'ADMIN', 'MEMBER']);
    for (const [action, roles] of Object.entries(PERMISSIONS)) {
      for (const r of roles) {
        expect(valid.has(r)).toBe(true);
      }
    }
  });
});

describe('canDo()', () => {
  test('OWNER puede workspace.delete', () => {
    expect(canDo('OWNER', 'workspace.delete')).toBe(true);
  });
  test('ADMIN no puede workspace.delete', () => {
    expect(canDo('ADMIN', 'workspace.delete')).toBe(false);
  });
  test('MEMBER puede mcp.generate', () => {
    expect(canDo('MEMBER', 'mcp.generate')).toBe(true);
  });
  test('MEMBER no puede dashboard.connect', () => {
    expect(canDo('MEMBER', 'dashboard.connect')).toBe(false);
  });
  test('OWNER puede dashboard.connect', () => {
    expect(canDo('OWNER', 'dashboard.connect')).toBe(true);
  });
  test('rol inexistente retorna false', () => {
    expect(canDo('VIEWER', 'workspace.view')).toBe(false);
  });
  test('acción inexistente retorna false (fail-closed)', () => {
    expect(canDo('OWNER', 'foo.bar.baz')).toBe(false);
  });
});

describe('roleSatisfies()', () => {
  test('OWNER satisface ADMIN', () => {
    expect(roleSatisfies('OWNER', 'ADMIN')).toBe(true);
  });
  test('ADMIN satisface MEMBER', () => {
    expect(roleSatisfies('ADMIN', 'MEMBER')).toBe(true);
  });
  test('ADMIN NO satisface OWNER', () => {
    expect(roleSatisfies('ADMIN', 'OWNER')).toBe(false);
  });
  test('mismo rol satisface', () => {
    expect(roleSatisfies('MEMBER', 'MEMBER')).toBe(true);
  });
  test('rol inexistente retorna false', () => {
    expect(roleSatisfies('VIEWER', 'MEMBER')).toBe(false);
    expect(roleSatisfies('MEMBER', 'VIEWER')).toBe(false);
  });
});

describe('actionsForRole()', () => {
  test('OWNER tiene todas las acciones', () => {
    const allActions = Object.keys(PERMISSIONS);
    const ownerActions = actionsForRole('OWNER');
    expect(ownerActions.sort()).toEqual(allActions.sort());
  });
  test('MEMBER no tiene workspace.delete ni billing.manage', () => {
    const memberActions = actionsForRole('MEMBER');
    expect(memberActions).not.toContain('workspace.delete');
    expect(memberActions).not.toContain('billing.manage');
    expect(memberActions).not.toContain('dashboard.connect');
  });
  test('rol inexistente retorna lista vacía', () => {
    expect(actionsForRole('VIEWER')).toEqual([]);
  });
});
