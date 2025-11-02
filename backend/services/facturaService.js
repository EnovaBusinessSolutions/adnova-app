// backend/services/facturaService.js
'use strict';
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

const DEFAULT_PRODUCT_CODE = process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100';
const DEFAULT_UNIT         = process.env.FACTURAPI_DEFAULT_UNIT || 'E48';
const DEFAULT_PAYMENT_FORM = process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03';
const DEFAULT_SERIE        = process.env.FACTURAPI_SERIE || 'ADN';
const DEFAULT_CURRENCY     = 'MXN';
const DEFAULT_CFDI_USE     = process.env.FACTURAPI_DEFAULT_USE || 'G03';
const DEFAULT_TAX_SYSTEM_EMISOR = process.env.FACTURAPI_DEFAULT_TAX_SYSTEM || '601';
const DEFAULT_ISSUER_ZIP        = process.env.FACTURAPI_ISSUER_ZIP || '64000';

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function genCustomerPayload(taxProfile) {
  if (taxProfile && taxProfile.rfc) {
    return {
      legal_name: taxProfile.legal_name || taxProfile.name,
      tax_id: (taxProfile.rfc || '').toUpperCase(),
      tax_system: (taxProfile.tax_regime || taxProfile.tax_system || '').toString() || DEFAULT_TAX_SYSTEM_EMISOR,
      address: taxProfile.zip ? { zip: taxProfile.zip } : undefined,
      email: taxProfile.email || undefined,
    };
  }
  return {
    legal_name: 'PÚBLICO EN GENERAL',
    tax_id: 'XAXX010101000',
    tax_system: '616',
    address: { zip: DEFAULT_ISSUER_ZIP },
  };
}

/**
 * Timbrado IVA incluido (SIN send_email / email / metadata).
 * Nota: separamos COMPLETAMENTE el envío por correo.
 */
async function emitirFactura({ customer, description, totalWithTax, cfdiUse }) {
  const total = round2(totalWithTax);
  if (total < 0.01) throw new Error('Total debe ser >= 0.01 para timbrar');

  // Precio base (subtotal) cuando el total ya incluye IVA
  const base = round2(total / 1.16);

  const invoice = await facturapi.invoices.create({
    customer,
    items: [{
      product: {
        description: description || 'Suscripción Adnova AI',
        product_key: DEFAULT_PRODUCT_CODE,
        unit_key: DEFAULT_UNIT,
        price: base,
        taxes: [{ type: 'IVA', rate: 0.16 }],
      },
      quantity: 1,
    }],
    currency: DEFAULT_CURRENCY,
    series: DEFAULT_SERIE,
    payment_form: DEFAULT_PAYMENT_FORM,
    use: cfdiUse || DEFAULT_CFDI_USE,
    // ❌ NO place_of_issue, NO send_email, NO email, NO metadata
  });

  return invoice;
}

/**
 * Enviar CFDI por email (desacoplado del timbrado).
 * Intenta ambos formatos del SDK y NO lanza error (solo loguea si falla).
 */
async function enviarCfdiPorEmail(invoiceId, email) {
  if (!invoiceId || !email) return;
  try {
    await facturapi.invoices.sendByEmail(invoiceId, email); // algunas versiones aceptan string
  } catch (_e1) {
    try {
      await facturapi.invoices.sendByEmail(invoiceId, { email }); // otras requieren { email }
    } catch (e2) {
      console.warn('CFDI timbrado OK, pero no se pudo enviar por email:', e2?.response?.data || e2.message);
    }
  }
}

module.exports = { facturapi, genCustomerPayload, emitirFactura, enviarCfdiPorEmail };
