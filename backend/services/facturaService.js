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
const isEmail = v => typeof v === 'string' && v.includes('@');

/** Construye el payload de cliente para Facturapi. */
function genCustomerPayload(taxProfile) {
  if (taxProfile && taxProfile.rfc) {
    return {
      legal_name:  taxProfile.legal_name || taxProfile.name,
      tax_id:      (taxProfile.rfc || '').toUpperCase(),
      tax_system:  (taxProfile.tax_regime || taxProfile.tax_system || '').toString() || DEFAULT_TAX_SYSTEM_EMISOR,
      address:     taxProfile.zip ? { zip: taxProfile.zip } : undefined,
      email:       taxProfile.email || undefined, // Facturapi puede tomarlo desde el cliente
    };
  }
  return {
    legal_name: 'PÚBLICO EN GENERAL',
    tax_id:     'XAXX010101000',
    tax_system: '616',
    address:    { zip: DEFAULT_ISSUER_ZIP },
  };
}


async function emitirFactura({ customer, description, totalWithTax, cfdiUse, sendEmailTo }) {
  const total = round2(totalWithTax);
  if (total < 0.01) throw new Error('Total debe ser >= 0.01 para timbrar');

  // IVA incluido → base (subtotal) = total / 1.16
  const base = round2(total / 1.16);

  const payload = {
    customer,
    items: [{
      product: {
        description: description || 'Suscripción Adnova AI',
        product_key: DEFAULT_PRODUCT_CODE,
        unit_key:    DEFAULT_UNIT,
        price:       base,                 // subtotal sin IVA
        taxes:       [{ type: 'IVA', rate: 0.16 }], // impuestos dentro de product
      },
      quantity: 1,
    }],
    currency:      DEFAULT_CURRENCY,
    series:        DEFAULT_SERIE,
    payment_form:  DEFAULT_PAYMENT_FORM,
    use:           cfdiUse || DEFAULT_CFDI_USE,
    // ❌ place_of_issue fuera (tu cuenta lo rechazaba)
    // ❌ metadata fuera (tu cuenta lo rechazaba)
  };

  // Envío por correo correcto (sin usar `email` a nivel factura)
  if (isEmail(sendEmailTo)) {
    payload.send_email = true;
    payload.additional_emails = [sendEmailTo];
  }

  const invoice = await facturapi.invoices.create(payload);
  return invoice;
}

module.exports = { facturapi, genCustomerPayload, emitirFactura };
