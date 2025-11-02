async function emitirFactura({ customer, description, totalWithTax, cfdiUse, sendEmailTo }) {
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const total = round2(totalWithTax);
  if (total < 0.01) throw new Error('Total debe ser >= 0.01 para timbrar');

  // IVA incluido -> base sin IVA
  const base = round2(total / 1.16);

  // 1) Crear la factura SIN flags de email/metadata/place_of_issue
  const invoice = await facturapi.invoices.create({
    customer,
    items: [{
      product: {
        description: description || 'Suscripción Adnova AI',
        product_key: process.env.FACTURAPI_DEFAULT_PRODUCT_CODE || '81112100',
        unit_key:    process.env.FACTURAPI_DEFAULT_UNIT || 'E48',
        price:       base,
        taxes: [{ type: 'IVA', rate: 0.16 }],
      },
      quantity: 1,
    }],
    currency:     'MXN',
    series:       process.env.FACTURAPI_SERIE || 'ADN',
    payment_form: process.env.FACTURAPI_DEFAULT_PAYMENT_FORM || '03',
    use:          cfdiUse || process.env.FACTURAPI_DEFAULT_USE || 'G03',
  });

  // 2) Enviar por correo después (no bloqueante)
  if (sendEmailTo && typeof facturapi.invoices.sendByEmail === 'function') {
    try {
      // Algunas versiones aceptan string simple...
      await facturapi.invoices.sendByEmail(invoice.id, sendEmailTo);
    } catch {
      try {
        // ...y otras esperan un objeto { email }
        await facturapi.invoices.sendByEmail(invoice.id, { email: sendEmailTo });
      } catch (e2) {
        console.warn('CFDI timbrado OK, pero no se pudo enviar por email:', e2?.response?.data || e2.message);
      }
    }
  }

  return invoice;
}
