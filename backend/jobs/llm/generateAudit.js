'use strict';

const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * generateAudit({ type, inputSnapshot })
 *  - type: 'google' | 'meta' | 'ga4'
 *  - inputSnapshot: salida de los collectors
 * Devuelve: { summary, issues: Issue[] }
 * Issue: { id?, title, area, severity, evidence, recommendation, estimatedImpact?, campaignRef?, segmentRef?, metrics?, links? }
 */
module.exports = async function generateAudit({ type, inputSnapshot, maxFindings = 10 }) {
  const isGA4 = type === 'ga4';
  const sys = isGA4
    ? `Eres un auditor senior de Google Analytics 4. Crea hallazgos accionables basados en canales/embudos.`
    : `Eres un auditor senior de ${type === 'google' ? 'Google Ads' : 'Meta Ads'}. Crea hallazgos accionables por campaña.`;

  const schema = isGA4
    ? `Cada hallazgo debe incluir:
- "title" corto y claro
- "area" en ["setup","performance","creative","tracking","budget","bidding"]
- "severity" en ["alta","media","baja"]
- "evidence" con datos del snapshot
- "recommendation" concreta
- "estimatedImpact" en ["alto","medio","bajo"]
- "segmentRef": { "type": "channel", "name": "<nombre del canal>" }
- "metrics": objeto con valores numéricos relevantes`
    : `Cada hallazgo debe incluir:
- "title" corto y claro
- "area" en ["setup","performance","creative","tracking","budget","bidding"]
- "severity" en ["alta","media","baja"]
- "evidence" con datos del snapshot
- "recommendation" concreta
- "estimatedImpact" en ["alto","medio","bajo"]
- "campaignRef": { "id": "<id campaña>", "name": "<nombre>" }
- "metrics": objeto con valores numéricos relevantes`;

  const prompt = `
CONSIGNA
- Devuelve JSON estricto con: { "summary": string, "issues": Issue[] (máx ${maxFindings}) }
- Idioma: español neutro
- No inventes métricas inexistentes

DATOS
${JSON.stringify(inputSnapshot).slice(0, 200000)}

FORMATO
${schema}
`.trim();

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: prompt }
    ]
  });

  const txt = resp.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(txt);
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    return { summary, issues: issues.slice(0, maxFindings) };
  } catch {
    // fallback mínimo
    return {
      summary: '',
      issues: []
    };
  }
};
