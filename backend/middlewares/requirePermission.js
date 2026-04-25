// backend/middlewares/requirePermission.js
'use strict';

const { PERMISSIONS, canDo } = require('../config/permissions');

/**
 * Factory que retorna un middleware de validación de permisos.
 *
 * Uso (en Fase 3):
 *   router.post('/api/workspaces/:id/members',
 *     ensureAuthenticated,
 *     resolveWorkspace,
 *     requirePermission('members.invite'),
 *     handler
 *   );
 *
 * Errores posibles:
 *   500 INTERNAL              — requirePermission usado sin resolveWorkspace antes.
 *   500 UNKNOWN_PERMISSION    — la acción no está declarada en PERMISSIONS.
 *   403 INSUFFICIENT_PERMISSION — el rol del user no tiene el permiso.
 *
 * @param {string} action - acción del catálogo PERMISSIONS (ej. 'members.invite').
 * @returns {Function} middleware
 */
function requirePermission(action) {
  if (typeof action !== 'string' || !action) {
    throw new Error('requirePermission: action must be a non-empty string');
  }

  // Validación temprana: si la acción no existe en PERMISSIONS, fallar al cargar el módulo
  // evita que descubras el error en producción cuando un usuario hace la request.
  if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, action)) {
    throw new Error(
      `requirePermission: unknown action "${action}". ` +
      `Add it to backend/config/permissions.js or fix the typo.`
    );
  }

  return function requirePermissionMiddleware(req, res, next) {
    const membership = req.workspaceMembership;

    if (!membership || !membership.role) {
      // El developer olvidó montar resolveWorkspace antes.
      console.error(
        `[requirePermission] used for action "${action}" without resolveWorkspace running first`
      );
      return res.status(500).json({
        error: 'INTERNAL',
        detail: 'requirePermission used without resolveWorkspace',
      });
    }

    if (!canDo(membership.role, action)) {
      return res.status(403).json({
        error: 'INSUFFICIENT_PERMISSION',
        action,
        userRole: membership.role,
      });
    }

    return next();
  };
}

module.exports = requirePermission;
