// backend/config/permissions.js
'use strict';

/**
 * Workspace roles, jerarquía estricta:
 *   OWNER (3) > ADMIN (2) > MEMBER (1)
 *
 * Esta es la fuente única de verdad sobre qué rol puede hacer qué.
 * Backend la consume vía requirePermission middleware.
 * Frontend la consumirá en Fase 5 (vía endpoint o build step).
 */

const ROLES = Object.freeze({
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
});

const ROLE_HIERARCHY = Object.freeze({
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
});

/**
 * Mapeo action → array de roles permitidos.
 * Cada acción usa el formato "<dominio>.<acción>".
 *
 * Si una acción no está aquí, requirePermission retornará 500 UNKNOWN_PERMISSION
 * para forzar que toda acción esté declarada explícitamente.
 */
const PERMISSIONS = Object.freeze({
  // ---- Workspace ----
  'workspace.view':              ['OWNER', 'ADMIN', 'MEMBER'],
  'workspace.update.name':       ['OWNER', 'ADMIN'],
  'workspace.update.icon':       ['OWNER', 'ADMIN'],
  'workspace.update.slug':       ['OWNER'],
  'workspace.update.industry':   ['OWNER', 'ADMIN'],
  'workspace.delete':            ['OWNER'],
  'workspace.transfer.ownership':['OWNER'],

  // ---- Members ----
  'members.view':                ['OWNER', 'ADMIN', 'MEMBER'],
  'members.invite':              ['OWNER', 'ADMIN'],
  'members.remove':              ['OWNER', 'ADMIN'],
  'members.changeRole':          ['OWNER', 'ADMIN'],
  'members.suspend':             ['OWNER', 'ADMIN'],

  // ---- Invitations ----
  'invitations.view':            ['OWNER', 'ADMIN'],
  'invitations.create':          ['OWNER', 'ADMIN'],
  'invitations.revoke':          ['OWNER', 'ADMIN'],

  // ---- Billing ----
  'billing.view':                ['OWNER', 'ADMIN'],
  'billing.manage':              ['OWNER'],
  'billing.changePlan':          ['OWNER'],

  // ---- Platform integrations (Meta, Google, Shopify) ----
  'platforms.view':              ['OWNER', 'ADMIN', 'MEMBER'],
  'platforms.connect':           ['OWNER', 'ADMIN'],
  'platforms.disconnect':        ['OWNER', 'ADMIN'],
  'platforms.changeSelection':   ['OWNER', 'ADMIN'],

  // ---- MCP / AI tools ----
  // Member SÍ puede usar ChatGPT/Claude/Signal PDF (decisión cerrada con el usuario).
  'mcp.view':                    ['OWNER', 'ADMIN', 'MEMBER'],
  'mcp.generate':                ['OWNER', 'ADMIN', 'MEMBER'],
  'mcp.revoke':                  ['OWNER', 'ADMIN'],

  // ---- Dashboard / data ----
  // dashboard.connect = pantalla "Connect Data Sources" (/dashboard).
  // Member NO la ve, va directo a /laststep.
  'dashboard.connect':           ['OWNER', 'ADMIN'],
  'attribution.view':            ['OWNER', 'ADMIN', 'MEMBER'],
  'audits.view':                 ['OWNER', 'ADMIN', 'MEMBER'],
  'audits.create':               ['OWNER', 'ADMIN'],
  'audits.delete':               ['OWNER', 'ADMIN'],
  'dailysignal.configure':       ['OWNER', 'ADMIN', 'MEMBER'],
  'signalpdf.generate':          ['OWNER', 'ADMIN', 'MEMBER'],
  'export.csv':                  ['OWNER', 'ADMIN', 'MEMBER'],
});

/**
 * Devuelve true si `role` puede ejecutar `action`.
 * Si `action` no está declarada en PERMISSIONS, retorna false (fail-closed).
 */
function canDo(role, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role);
}

/**
 * Compara roles por jerarquía. Retorna true si `role` >= `minRole`.
 * Útil para casos donde no necesitas una acción específica, solo nivel mínimo.
 */
function roleSatisfies(role, minRole) {
  const a = ROLE_HIERARCHY[role];
  const b = ROLE_HIERARCHY[minRole];
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return a >= b;
}

/**
 * Lista de acciones que un rol específico puede ejecutar.
 * Útil para construir el manifest del frontend en Fase 5.
 */
function actionsForRole(role) {
  return Object.entries(PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([action]) => action);
}

module.exports = {
  ROLES,
  ROLE_HIERARCHY,
  PERMISSIONS,
  canDo,
  roleSatisfies,
  actionsForRole,
};
