'use strict';
const Facturapi = (require('facturapi').default || require('facturapi'));
const facturapi = new Facturapi(process.env.FACTURAPI_KEY);

// Helpers ambientes / defaults
const DEFAULT_PRODUCT_CODE = process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100'; // servicios SW
const DEFAULT_UNIT = process.env.FACTURAPI_DEFAULT_UNIT || 'E48';
const DEFAULT_PAYMENT_FORM = process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03'; // Transferencia
const DEFAULT_SERIE = process.env.FACTURAPI_SERIE || 'ADN';
const DEFAULT_CURRENCY = 'MXN';

const genCustomerPayload = (taxProfile) => {
  if (!taxProfile) {
    // Público en general
    return {
      legal_name: 'PUBLICO EN GENERAL',
      tax_id: 'XAXX010101000',
      email: undefined
    };
  }
  return {
    legal_name: taxProfile.name,
    tax_id: taxProfile.rfc.toUpperCase(),
    email: taxProfile.email || undefined,
    address: taxProfile.zip ? { zip: taxProfile.zip } : undefined
  };
};

/**
 * Emite CFDI con precio IVA incluido.
 * @param {Object} params
 *  - customer (obj de Facturapi, ya preparado)
 *  - description (string)
 *  - totalWithTax (number en MXN)
 *  - cfdiUse (string SAT, ej 'G03')
 *  - sendEmailTo (string opcional)
 *  - metadata (obj opcional)
 */
async function emitirFactura({ customer, description, totalWithTax, cfdiUse, sendEmailTo, metadata }) {
  // IVA incluido → obtener base e IVA (16%)
  const base = +(totalWithTax / 1.16).toFixed(2);
  const tax = +(totalWithTax - base).toFixed(2);

  const invoice = await facturapi.invoices.create({
    customer,
    items: [{
      product: {
        description: description || 'Suscripción Adnova AI',
        product_key: DEFAULT_PRODUCT_CODE,
        unit_key: DEFAULT_UNIT
      },
      unit_price: base,
      quantity: 1,
      taxes: [{ type: 'IVA', rate: 0.16, included: false }],
      discount: 0
    }],
    currency: DEFAULT_CURRENCY,
    series: DEFAULT_SERIE,
    payment_form: DEFAULT_PAYMENT_FORM,
    use: cfdiUse || process.env.FACTURAPI_DEFAULT_USE || 'G03',
    send_email: !!sendEmailTo,
    email: sendEmailTo,
    metadata
  });

  return invoice;
}

module.exports = {
  facturapi,
  genCustomerPayload,
  emitirFactura
};
