// backend/services/creativeRecommendationEngine.js
'use strict';

/**
 * Creative Recommendation Engine - AdrayAI
 * Generates actionable recommendations based on scores and metrics
 */

const crypto = require('crypto');

// Generate UUID v4
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Generate recommendations for a creative
 * @param {object} params
 * @param {object} params.scores - { value, risk, alignment, total }
 * @param {object} params.metrics - current metrics
 * @param {object} params.deltas - % changes
 * @param {string} params.tier - star|good|average|poor|critical
 * @param {string} params.objective - ventas|alcance|leads
 * @param {string} params.effectiveStatus - ACTIVE|PAUSED|etc
 */
function generateRecommendations({ scores, metrics, deltas, tier, objective, effectiveStatus }) {
  const recommendations = [];
  
  const add = (category, priority, message, action) => {
    recommendations.push({
      id: generateUUID(),
      category,
      priority,
      message,
      action,
      checked: false,
      checkedAt: null,
    });
  };
  
  // ============= SCALE RECOMMENDATIONS (High performers) =============
  if (tier === 'star') {
    add('scale', 90, 
      '⭐ Este creativo es estrella. Considera aumentar el presupuesto 20-30% para maximizar resultados.',
      'Incrementar presupuesto del adset');
    
    if (metrics.frequency && metrics.frequency < 2) {
      add('scale', 85,
        '📈 La frecuencia es baja y el rendimiento es excelente. Hay espacio para escalar sin saturar.',
        'Expandir audiencia o incrementar presupuesto');
    }
  }
  
  if (tier === 'good' && scores.value >= 70) {
    add('scale', 75,
      '✅ Buen desempeño. Prueba aumentar gradualmente el presupuesto mientras monitoreas el ROAS/CPA.',
      'Incremento gradual de presupuesto (10-15%)');
  }
  
  // ============= OPTIMIZATION RECOMMENDATIONS =============
  
  // CTR bajo
  if (metrics.ctr != null && metrics.ctr < 0.01) {
    add('optimize', 70,
      '👀 CTR bajo (<1%). El creativo no está captando atención suficiente.',
      'Prueba un nuevo hook visual o copy más directo');
  }
  
  // CTR en declive
  if (deltas?.ctr != null && deltas.ctr < -0.15) {
    const pct = Math.abs(Math.round(deltas.ctr * 100));
    add('optimize', 75,
      `📉 El CTR cayó ${pct}% vs período anterior. La audiencia puede estar saturándose.`,
      'Rota el creativo o refresca el copy/imagen');
  }
  
  // CPA muy alto (ventas)
  if (objective === 'ventas' && metrics.cpa != null && metrics.cpa > 400) {
    add('optimize', 80,
      `💸 CPA muy alto ($${Math.round(metrics.cpa)}). Este creativo no está convirtiendo eficientemente.`,
      'Optimiza la landing page o cambia el público objetivo');
  }
  
  // ROAS bajo (ventas)
  if (objective === 'ventas' && metrics.roas != null && metrics.roas < 1.5) {
    add('optimize', 85,
      `📊 ROAS de ${metrics.roas.toFixed(2)}x es bajo. El creativo no genera suficiente retorno.`,
      'Revisa el mensaje de venta y la oferta');
  }
  
  // CPL alto (leads)
  if (objective === 'leads' && metrics.cpl != null && metrics.cpl > 250) {
    add('optimize', 80,
      `📋 Costo por lead de $${Math.round(metrics.cpl)} es elevado.`,
      'Simplifica el formulario o mejora la propuesta de valor');
  }
  
  // CPM alto (alcance)
  if (objective === 'alcance' && metrics.cpm != null && metrics.cpm > 100) {
    add('optimize', 70,
      `📡 CPM de $${Math.round(metrics.cpm)} es alto para campañas de alcance.`,
      'Revisa la segmentación - audiencias muy específicas aumentan CPM');
  }
  
  // ============= ALERT RECOMMENDATIONS (Risk factors) =============
  
  // High frequency = fatigue
  if (metrics.frequency != null && metrics.frequency > 4) {
    add('alert', 90,
      `🔄 Frecuencia de ${metrics.frequency.toFixed(1)} indica fatiga de audiencia.`,
      'Rota el creativo urgentemente o expande el público');
  } else if (metrics.frequency != null && metrics.frequency > 2.8) {
    add('alert', 70,
      `⚠️ Frecuencia de ${metrics.frequency.toFixed(1)} está elevándose. Monitorea el rendimiento.`,
      'Prepara variaciones del creativo para rotar pronto');
  }
  
  // ROAS dropping
  if (deltas?.roas != null && deltas.roas < -0.25) {
    const pct = Math.abs(Math.round(deltas.roas * 100));
    add('alert', 85,
      `🚨 ROAS cayó ${pct}% vs período anterior. El creativo está perdiendo efectividad.`,
      'Considera pausar y probar nuevas variaciones');
  }
  
  // CPA spiking
  if (deltas?.cpa != null && deltas.cpa > 0.30) {
    const pct = Math.round(deltas.cpa * 100);
    add('alert', 80,
      `⬆️ CPA aumentó ${pct}%. El costo de adquisición se está disparando.`,
      'Revisa cambios recientes en audiencia o puja');
  }
  
  // CPL spiking
  if (deltas?.cpl != null && deltas.cpl > 0.30) {
    const pct = Math.round(deltas.cpl * 100);
    add('alert', 80,
      `⬆️ CPL aumentó ${pct}%. Los leads se están encareciendo.`,
      'Optimiza el formulario o revisa la calidad de la audiencia');
  }
  
  // Critical/Poor tier
  if (tier === 'critical') {
    add('alert', 95,
      '🛑 Rendimiento crítico. Este creativo está desperdiciando presupuesto.',
      'Pausa este creativo y redistribuye el presupuesto');
  } else if (tier === 'poor') {
    add('alert', 75,
      '⚠️ Rendimiento pobre. Necesita optimización urgente o reemplazo.',
      'Prueba cambios significativos en copy/visual o pausa');
  }
  
  // Low spend but active (not getting delivery)
  if (effectiveStatus === 'ACTIVE' && metrics.spend != null && metrics.spend < 10 && metrics.impressions < 500) {
    add('info', 50,
      '💤 Este anuncio activo tiene muy poca entrega. Puede estar perdiendo en la subasta.',
      'Revisa la puja y el presupuesto del adset');
  }
  
  // ============= INFO RECOMMENDATIONS =============
  
  // Paused creative with good historical performance
  if (effectiveStatus === 'PAUSED' && tier !== 'critical' && tier !== 'poor') {
    add('info', 40,
      '⏸️ Este creativo está pausado pero tenía buen rendimiento histórico.',
      'Considera reactivarlo si necesitas más volumen');
  }
  
  // Good alignment potential (future feature hint)
  if (scores.alignment === 50 && tier === 'average') {
    add('info', 30,
      '💡 Tip: Alinear el mensaje del anuncio con tu landing page puede mejorar conversiones.',
      'Revisa que la oferta del anuncio coincida con la página de destino');
  }
  
  // Sort by priority (highest first)
  recommendations.sort((a, b) => b.priority - a.priority);
  
  // Limit to top 5 recommendations
  return recommendations.slice(0, 5);
}

/**
 * Mark a recommendation as checked/completed
 */
function markRecommendationChecked(recommendations, recommendationId) {
  const rec = recommendations.find(r => r.id === recommendationId);
  if (rec) {
    rec.checked = true;
    rec.checkedAt = new Date();
  }
  return recommendations;
}

/**
 * Uncheck a recommendation
 */
function markRecommendationUnchecked(recommendations, recommendationId) {
  const rec = recommendations.find(r => r.id === recommendationId);
  if (rec) {
    rec.checked = false;
    rec.checkedAt = null;
  }
  return recommendations;
}

module.exports = {
  generateRecommendations,
  markRecommendationChecked,
  markRecommendationUnchecked,
};
