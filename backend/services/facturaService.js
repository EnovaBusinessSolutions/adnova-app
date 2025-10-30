'use strict';
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Defaults / ambiente
const DEFAULT_PRODUCT_CODE = process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100'; // Servicios de software
const DEFAULT_UNIT         = process.env.FACTURAPI_DEFAULT_UNIT || 'E48';
const DEFAULT_PAYMENT_FORM = process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03';       // Transferencia
const DEFAULT_SERIE        = process.env.FACTURAPI_SERIE || 'ADN';
const DEFAULT_CURRENCY     = 'MXN';
const DEFAULT_USE          = process.env.FACTURAPI_DEFAULT_USE || 'G03';
const DEFAULT_TAX_SYSTEM   = process.env.FACTURAPI_DEFAULT_TAX_SYSTEM || '601';       // General de Ley Personas Morales
const ISSUER_ZIP           = process.env.FACTURAPI_ISSUER_ZIP || '64000';             // ZIP emisor para público en general


function genCustomerPayload(taxProfile) {
  if (taxProfile) {
    return {
      legal_name:  taxProfile.legal_name || taxProfile.name,
      tax_id:      String(taxProfile.rfc || '').toUpperCase(),
      tax_system:  taxProfile.tax_regime || taxProfile.tax_system || DEFAULT_TAX_SYSTEM,
      address:     taxProfile.zip ? { zip: taxProfile.zip } : undefined,
      email:       taxProfile.email || undefined,
    };
  }

  // Público en general
  return {
    legal_name: 'PÚBLICO EN GENERAL',
    tax_id:     'XAXX010101000',
    tax_system: DEFAULT_TAX_SYSTEM,
    address:    { zip: ISSUER_ZIP },
    // sin email: Facturapi no enviará correo si no lo pasamos
  };
}


async function emitirFactura({ customer, description, totalWithTax, cfdiUse, sendEmailTo, metadata }) {
  // Desglosa IVA (16%): precio base sin IVA para product.price
  const base = +(Number(totalWithTax) / 1.16).toFixed(2);

  const payload = {
    customer,
    items: [{
      product: {
        description:  description || 'Suscripción Adnova AI',
        product_key:  DEFAULT_PRODUCT_CODE,
        unit_key:     DEFAULT_UNIT,
        price:        base,                // <-- REQUERIDO por Facturapi
      },
      quantity: 1,
      taxes: [{
        type:     'IVA',
        rate:     0.16,
        included: false,                   // precio NO incluye IVA (lo desglosa)
      }],
      discount: 0,
    }],
    currency:      DEFAULT_CURRENCY,
    series:        DEFAULT_SERIE,
    payment_form:  DEFAULT_PAYMENT_FORM,
    use:           cfdiUse || DEFAULT_USE,
    send_email:    !!sendEmailTo,
    email:         sendEmailTo,
    metadata,
  };

  const invoice = await facturapi.invoices.create(payload);
  return invoice;
}

module.exports = {
  facturapi,
  genCustomerPayload,
  emitirFactura,
};
