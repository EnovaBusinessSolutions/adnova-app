// backend/services/creativeScoreEngine.js
'use strict';

/**
 * Creative Score Engine - AdrayAI
 * Calculates Value, Risk, and Alignment scores for Meta creatives
 * 
 * Score breakdown:
 * - Value Score (0-100): Performance vs objective
 * - Risk Score (0-100): Creative fatigue/decay indicators
 * - Alignment Score (0-100): Message-to-landing alignment (MVP = 50 neutral)
 * 
 * Total Score = weighted average based on objective
 */

const THRESHOLDS = {
  // Ventas (Sales) objective thresholds
  ventas: {
    roas: { excellent: 4.0, good: 2.5, average: 1.5, poor: 1.0 },
    cpa: { excellent: 100, good: 200, average: 350, poor: 500 },  // lower is better
    cvr: { excellent: 0.04, good: 0.025, average: 0.015, poor: 0.008 },
    ctr: { excellent: 0.025, good: 0.015, average: 0.01, poor: 0.005 },
  },
  
  // Alcance (Awareness/Reach) objective thresholds  
  alcance: {
    cpm: { excellent: 30, good: 50, average: 80, poor: 120 },  // lower is better
    frequency: { excellent: 1.5, good: 2.5, average: 4, poor: 6 },  // lower is better
    reach: { excellent: 10000, good: 5000, average: 2000, poor: 500 },
    ctr: { excellent: 0.015, good: 0.01, average: 0.007, poor: 0.004 },
  },
  
  // Leads objective thresholds
  leads: {
    cpl: { excellent: 50, good: 100, average: 200, poor: 350 },  // lower is better
    cvr: { excellent: 0.05, good: 0.03, average: 0.02, poor: 0.01 },
    ctr: { excellent: 0.02, good: 0.012, average: 0.008, poor: 0.005 },
  },
};

// Score weights by objective
const WEIGHTS = {
  ventas: { value: 0.50, risk: 0.35, alignment: 0.15 },
  alcance: { value: 0.45, risk: 0.35, alignment: 0.20 },
  leads: { value: 0.50, risk: 0.30, alignment: 0.20 },
};

/**
 * Calculate percentile score (0-100) for a metric
 * @param {number} value - actual metric value
 * @param {object} thresholds - { excellent, good, average, poor }
 * @param {boolean} lowerIsBetter - true for metrics like CPA, CPL, CPM
 */
function calculateMetricScore(value, thresholds, lowerIsBetter = false) {
  if (value == null || !isFinite(value)) return 50;  // neutral if no data
  
  const { excellent, good, average, poor } = thresholds;
  
  if (lowerIsBetter) {
    if (value <= excellent) return 95;
    if (value <= good) return 75 + ((good - value) / (good - excellent)) * 20;
    if (value <= average) return 50 + ((average - value) / (average - good)) * 25;
    if (value <= poor) return 25 + ((poor - value) / (poor - average)) * 25;
    return Math.max(5, 25 - ((value - poor) / poor) * 20);
  } else {
    if (value >= excellent) return 95;
    if (value >= good) return 75 + ((value - good) / (excellent - good)) * 20;
    if (value >= average) return 50 + ((value - average) / (good - average)) * 25;
    if (value >= poor) return 25 + ((value - poor) / (average - poor)) * 25;
    return Math.max(5, 25 * (value / poor));
  }
}

/**
 * Calculate Value Score based on objective
 */
function calculateValueScore(metrics, objective) {
  const t = THRESHOLDS[objective];
  if (!t) return 50;
  
  const scores = [];
  const weights = [];
  
  switch (objective) {
    case 'ventas':
      // ROAS is primary for sales
      if (metrics.roas != null) {
        scores.push(calculateMetricScore(metrics.roas, t.roas, false));
        weights.push(0.40);
      }
      // CPA secondary
      if (metrics.cpa != null && metrics.cpa > 0) {
        scores.push(calculateMetricScore(metrics.cpa, t.cpa, true));
        weights.push(0.30);
      }
      // CVR
      if (metrics.cvr != null) {
        scores.push(calculateMetricScore(metrics.cvr, t.cvr, false));
        weights.push(0.20);
      }
      // CTR
      if (metrics.ctr != null) {
        scores.push(calculateMetricScore(metrics.ctr, t.ctr, false));
        weights.push(0.10);
      }
      break;
      
    case 'alcance':
      // CPM is primary for reach
      if (metrics.cpm != null && metrics.cpm > 0) {
        scores.push(calculateMetricScore(metrics.cpm, t.cpm, true));
        weights.push(0.35);
      }
      // Frequency
      if (metrics.frequency != null) {
        scores.push(calculateMetricScore(metrics.frequency, t.frequency, true));
        weights.push(0.25);
      }
      // Reach
      if (metrics.reach != null) {
        scores.push(calculateMetricScore(metrics.reach, t.reach, false));
        weights.push(0.25);
      }
      // CTR
      if (metrics.ctr != null) {
        scores.push(calculateMetricScore(metrics.ctr, t.ctr, false));
        weights.push(0.15);
      }
      break;
      
    case 'leads':
      // CPL is primary
      if (metrics.cpl != null && metrics.cpl > 0) {
        scores.push(calculateMetricScore(metrics.cpl, t.cpl, true));
        weights.push(0.45);
      }
      // Lead CVR
      if (metrics.cvr != null) {
        scores.push(calculateMetricScore(metrics.cvr, t.cvr, false));
        weights.push(0.35);
      }
      // CTR
      if (metrics.ctr != null) {
        scores.push(calculateMetricScore(metrics.ctr, t.ctr, false));
        weights.push(0.20);
      }
      break;
  }
  
  if (scores.length === 0) return 50;
  
  // Weighted average
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedSum = scores.reduce((sum, score, i) => sum + score * weights[i], 0);
  
  return Math.round(Math.min(100, Math.max(0, weightedSum / totalWeight)));
}

/**
 * Calculate Risk Score (creative fatigue/decay)
 */
function calculateRiskScore(metrics, metricsPrev, deltas) {
  let riskFactors = [];
  
  // 1. High frequency = fatigue risk
  if (metrics.frequency != null) {
    if (metrics.frequency > 5) riskFactors.push(85);
    else if (metrics.frequency > 3.5) riskFactors.push(65);
    else if (metrics.frequency > 2.5) riskFactors.push(45);
    else if (metrics.frequency > 1.8) riskFactors.push(25);
    else riskFactors.push(10);
  }
  
  // 2. CTR decline = fatigue signal
  if (deltas?.ctr != null) {
    const ctrDelta = deltas.ctr;
    if (ctrDelta < -0.30) riskFactors.push(90);
    else if (ctrDelta < -0.20) riskFactors.push(70);
    else if (ctrDelta < -0.10) riskFactors.push(50);
    else if (ctrDelta < -0.05) riskFactors.push(30);
    else riskFactors.push(10);
  }
  
  // 3. CPA/CPL increase = performance decay
  const costMetricDelta = deltas?.cpa ?? deltas?.cpl ?? null;
  if (costMetricDelta != null) {
    if (costMetricDelta > 0.40) riskFactors.push(85);
    else if (costMetricDelta > 0.25) riskFactors.push(65);
    else if (costMetricDelta > 0.15) riskFactors.push(45);
    else if (costMetricDelta > 0.05) riskFactors.push(25);
    else riskFactors.push(10);
  }
  
  // 4. ROAS decline (for sales)
  if (deltas?.roas != null) {
    const roasDelta = deltas.roas;
    if (roasDelta < -0.35) riskFactors.push(85);
    else if (roasDelta < -0.20) riskFactors.push(60);
    else if (roasDelta < -0.10) riskFactors.push(40);
    else riskFactors.push(15);
  }
  
  if (riskFactors.length === 0) return 30;  // neutral-low if no data
  
  // Average risk factors
  const avgRisk = riskFactors.reduce((a, b) => a + b, 0) / riskFactors.length;
  
  // Invert: high risk = LOW score (0 = max risk, 100 = no risk)
  return Math.round(Math.max(0, Math.min(100, 100 - avgRisk)));
}

/**
 * Calculate Alignment Score (MVP = neutral 50)
 * Future: Compare creative messaging to landing page
 */
function calculateAlignmentScore(/* creative, landingPage */) {
  // MVP: Return neutral score
  return 50;
}

/**
 * Calculate total weighted score
 */
function calculateTotalScore(valueScore, riskScore, alignmentScore, objective) {
  const w = WEIGHTS[objective] || WEIGHTS.ventas;
  
  const total = (
    valueScore * w.value +
    riskScore * w.risk +
    alignmentScore * w.alignment
  );
  
  return Math.round(Math.min(100, Math.max(0, total)));
}

/**
 * Get tier from total score
 */
function getTierFromScore(score) {
  if (score >= 80) return 'star';
  if (score >= 65) return 'good';
  if (score >= 45) return 'average';
  if (score >= 25) return 'poor';
  return 'critical';
}

/**
 * Calculate delta (% change) between current and previous
 */
function calculateDeltas(metrics, metricsPrev) {
  const deltas = {};
  
  const calcDelta = (curr, prev, key) => {
    if (curr == null || prev == null || prev === 0) return null;
    return (curr - prev) / prev;
  };
  
  deltas.spend = calcDelta(metrics.spend, metricsPrev.spend);
  deltas.impressions = calcDelta(metrics.impressions, metricsPrev.impressions);
  deltas.reach = calcDelta(metrics.reach, metricsPrev.reach);
  deltas.clicks = calcDelta(metrics.clicks, metricsPrev.clicks);
  deltas.ctr = calcDelta(metrics.ctr, metricsPrev.ctr);
  deltas.cpc = calcDelta(metrics.cpc, metricsPrev.cpc);
  deltas.cpm = calcDelta(metrics.cpm, metricsPrev.cpm);
  deltas.purchases = calcDelta(metrics.purchases, metricsPrev.purchases);
  deltas.revenue = calcDelta(metrics.revenue, metricsPrev.revenue);
  deltas.roas = calcDelta(metrics.roas, metricsPrev.roas);
  deltas.cpa = calcDelta(metrics.cpa, metricsPrev.cpa);
  deltas.leads = calcDelta(metrics.leads, metricsPrev.leads);
  deltas.cpl = calcDelta(metrics.cpl, metricsPrev.cpl);
  deltas.frequency = calcDelta(metrics.frequency, metricsPrev.frequency);
  
  // Remove nulls
  Object.keys(deltas).forEach(k => {
    if (deltas[k] == null) delete deltas[k];
  });
  
  return deltas;
}

/**
 * Main: Calculate all scores for a creative
 */
function calculateCreativeScores(metrics, metricsPrev, objective = 'ventas') {
  const deltas = calculateDeltas(metrics, metricsPrev);
  
  const valueScore = calculateValueScore(metrics, objective);
  const riskScore = calculateRiskScore(metrics, metricsPrev, deltas);
  const alignmentScore = calculateAlignmentScore();
  const totalScore = calculateTotalScore(valueScore, riskScore, alignmentScore, objective);
  const tier = getTierFromScore(totalScore);
  
  return {
    scores: {
      value: valueScore,
      risk: riskScore,
      alignment: alignmentScore,
      total: totalScore,
    },
    tier,
    deltas,
  };
}

module.exports = {
  calculateCreativeScores,
  calculateValueScore,
  calculateRiskScore,
  calculateAlignmentScore,
  calculateTotalScore,
  getTierFromScore,
  calculateDeltas,
  calculateMetricScore,
  THRESHOLDS,
  WEIGHTS,
};
