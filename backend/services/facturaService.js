'use strict';
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Defaults (ajústalos en .env si quieres)
const DEFAULT_PRODUCT_CODE = process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100'; // Servicios de software
const DEFAULT_UNIT         = process.env.FACTURAPI_DEFAULT_UNIT || 'E48';
const DEFAULT_PAYMENT_FORM = process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03'; // Transferencia
const DEFAULT_SERIE        = process.env.FACTURAPI_SERIE || 'ADN';
const DEFAULT_CURRENCY     = 'MXN';
const DEFAULT_CFDI_USE     = process.env.FACTURAPI_DEFAULT_USE || 'G03'; // Gastos en general

// ⚠️ Emisor (tu organización) suele ser 601; EL CLIENTE "PÚBLICO EN GENERAL" es 616
const DEFAULT_TAX_SYSTEM_EMISOR = process.env.FACTURAPI_DEFAULT_TAX_SYSTEM || '601';
const DEFAULT_ISSUER_ZIP        = process.env.FACTURAPI_ISSUER_ZIP || '64000';

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

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

  // Público en general (XAXX...) → tax_system OBLIGATORIAMENTE 616
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
 * Facturapi requiere el precio en product.price y declarar taxes con included:true
 */
async function emitirFactura({ customer, description, totalWithTax, cfdiUse, sendEmailTo, metadata }) {
  const total = round2(totalWithTax);
  const base  = round2(total / 1.16);      // subtotal
  // const iva   = round2(total - base);    // por si lo quieres loguear

  const invoice = await facturapi.invoices.create({
    customer,
    items: [{
      product: {
        description: description || 'Suscripción Adnova AI',
        product_key: DEFAULT_PRODUCT_CODE,
        unit_key: DEFAULT_UNIT,
        price: base,                      // 👈 precio base (sin IVA)
      },
      quantity: 1,
      // IVA incluido en el precio final
      taxes: [{ type: 'IVA', rate: 0.16, included: true }],
      discount: 0,
    }],
    currency: DEFAULT_CURRENCY,
    series: DEFAULT_SERIE,
    payment_form: DEFAULT_PAYMENT_FORM,
    use: cfdiUse || DEFAULT_CFDI_USE,
    send_email: !!sendEmailTo,
    email: sendEmailTo,
    metadata,
  });

  return invoice;
}

module.exports = { facturapi, genCustomerPayload, emitirFactura };
