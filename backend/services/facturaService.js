'use strict';
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Defaults
const DEFAULT_PRODUCT_CODE = process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100'; // Servicios de software
const DEFAULT_UNIT         = process.env.FACTURAPI_DEFAULT_UNIT || 'E48';
const DEFAULT_PAYMENT_FORM = process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03'; // Transferencia
const DEFAULT_SERIE        = process.env.FACTURAPI_SERIE || 'ADN';
const DEFAULT_CURRENCY     = 'MXN';
const DEFAULT_CFDI_USE     = process.env.FACTURAPI_DEFAULT_USE || 'G03'; // Gastos en general

// Emisor: 601; Público en general: 616
const DEFAULT_TAX_SYSTEM_EMISOR = process.env.FACTURAPI_DEFAULT_TAX_SYSTEM || '601';
const DEFAULT_ISSUER_ZIP        = process.env.FACTURAPI_ISSUER_ZIP || '64000';

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

/**
 * Genera el payload del cliente (Facturapi.customer) a partir del TaxProfile local.
 */
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

  // Público en general
  return {
    legal_name: 'PÚBLICO EN GENERAL',
    tax_id: 'XAXX010101000',
    tax_system: '616',
    address: { zip: DEFAULT_ISSUER_ZIP },
    email: undefined,
  };
}

/**
 * Emite CFDI con precio final IVA incluido.
 * ✅ En tu cuenta, Facturapi exige:
 *    - precio dentro de product.price
 *    - impuestos dentro de product.taxes (NO en el item)
 */
async function emitirFactura({ customer, description, totalWithTax, cfdiUse, sendEmailTo, metadata }) {
  const total = round2(totalWithTax);
  if (total < 0.01) {
    throw new Error('Total debe ser >= 0.01 para timbrar');
  }

  // IVA incluido → base (subtotal) = total / 1.16
  const base = round2(total / 1.16);

  const invoice = await facturapi.invoices.create({
    customer,
    items: [
      {
        // ❗️ Nada de taxes a nivel item
        product: {
          description: description || 'Suscripción Adnova AI',
          product_key: DEFAULT_PRODUCT_CODE,
          unit_key: DEFAULT_UNIT,
          price: base, // subtotal sin IVA
          // ✅ Impuestos dentro de product
          taxes: [{ type: 'IVA', rate: 0.16 }],
        },
        quantity: 1,
        // discount: 0 // opcional
      }
    ],
    currency: DEFAULT_CURRENCY,
    series: DEFAULT_SERIE,
    payment_form: DEFAULT_PAYMENT_FORM,
    use: cfdiUse || DEFAULT_CFDI_USE,
    place_of_issue: DEFAULT_ISSUER_ZIP, // recomendado si lo tienes en .env
    send_email: !!sendEmailTo,
    email: sendEmailTo,
    metadata,
  });

  return invoice;
}

module.exports = { facturapi, genCustomerPayload, emitirFactura };
