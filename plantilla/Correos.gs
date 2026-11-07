/**
 * Correos.gs — OPCIONAL. Lee en tu Gmail los avisos del banco y los registra solos.
 *   Hoy entiende: compras con tarjeta de Banco de Chile / Edwards, transferencias enviadas desde
 *   Banco de Chile y transferencias recibidas (avisos de Santander, Itaú, BCI, BancoEstado…).
 *
 * Al pegar este archivo, Google pedirá permiso para leer y organizar tu Gmail: el script busca solo
 * correos de bancos, les pone la etiqueta "Gastos-procesado" y los archiva. No envía nada a nadie.
 *
 * Instalación: en Apps Script, "+" junto a Archivos → Secuencia de comandos → nómbralo Correos → pega esto.
 * Recarga la hoja y usa "Gastos → Activar lectura de correos del banco".
 */

// Solo se leen los correos recibidos desde esta fecha ('aaaa/mm/dd').
// Vacío = desde el día en que activaste la lectura.
const CORREO_DESDE = '';

/* ---------- Correos Banco de Chile / Edwards ---------- */

/**
 * Formato (oct 2026), asunto "Compra con Tarjeta de Crédito":
 * "Te informamos que se ha realizado una compra por $58.960 con Tarjeta de
 *  Crédito ****5678 en MERPAGO*MCDONALDSCHI el 04/10/2026 17:41."
 * Se ejecuta sola cada 10 minutos (ver crearActivador).
 */
function revisarCorreos() {
  // 1) Notificaciones de Santander que quedaron en respaldo (Sheet sin espacio, etc.)
  reintentarRespaldo_();

  const label = GmailApp.getUserLabelByName(LABEL_PROCESADO) || GmailApp.createLabel(LABEL_PROCESADO);
  const fin = ' after:' + correoDesde_() + ' -label:' + LABEL_PROCESADO;

  // 2) Transferencias: las que haces (comprobante de Banco de Chile) y las que te hacen
  //    (aviso del banco de quien te transfiere: Santander, Itaú, …). Van antes que las compras.
  GmailApp.search('("has realizado una transferencia" OR "transferencia a tu cuenta" OR ' +
                  '"ha instruido una transferencia" OR "ha efectuado una transferencia" OR ' +
                  '"transferencia de fondos a tu cuenta" OR "te ha transferido" OR "te transfirió")' + fin, 0, 30)
    .forEach(function (hilo) {
      let todoOk = true;
      hilo.getMessages().forEach(function (msg) { if (!procesarCorreoTransf_(msg)) todoOk = false; });
      cerrarHilo_(hilo, label, todoOk);
    });

  // 3) Compras con tarjeta de Banco de Chile / Edwards
  GmailApp.search('from:(bancoedwards.cl OR bancochile.cl) subject:(compra OR "cargo en cuenta")' + fin, 0, 30)
    .forEach(function (hilo) {
      let todoOk = true;
      hilo.getMessages().forEach(function (msg) {
        const texto = msg.getPlainBody().replace(/\s+/g, ' ').trim();
        const p = parsearBChile_(texto);
        if (p) {
          agregarGasto_({
            id: 'm-' + msg.getId(),
            monto: p.monto,
            descripcion: p.comercio,
            medio: p.medio,
            categoria: '',
            fecha: p.fecha,
            origen: 'BChile auto'
          });
        } else {
          registrarSinProcesar_('[Correo] ' + msg.getSubject() + ' | ' + texto.slice(0, 500));
          todoOk = false;
        }
      });
      cerrarHilo_(hilo, label, todoOk);
    });
}

/**
 * Marca el hilo como procesado (no se vuelve a leer) y, si todo se registró bien, lo saca de la
 * bandeja de entrada: queda en la etiqueta "Gastos-procesado" de Gmail. Lo que no se entendió
 * (publicidad del banco, formatos nuevos) se queda en la bandeja para que lo veas.
 */
function cerrarHilo_(hilo, label, todoOk) {
  hilo.addLabel(label);
  if (todoOk && ARCHIVAR_PROCESADOS) hilo.moveToArchive();
}

/** Ejecútala UNA vez: saca de la bandeja de entrada los correos que ya se habían procesado. */
function archivarProcesados() {
  let total = 0;
  for (let k = 0; k < 20; k++) {
    const hilos = GmailApp.search('label:' + LABEL_PROCESADO + ' in:inbox', 0, 100);
    if (!hilos.length) break;
    GmailApp.moveThreadsToArchive(hilos);
    total += hilos.length;
  }
  Logger.log('Hilos archivados: ' + total);
}

function parsearBChile_(t) {
  const mUsd = t.match(/compra por US\$\s*([\d.,]+)/i);
  const mMonto = mUsd ? null : t.match(/compra por \$\s*([\d.]+)/i);
  if (!mMonto && !mUsd) return null;
  const mTipo  = t.match(/Tarjeta de (Cr[eé]dito|D[eé]bito)/i);
  const mCom   = t.match(/\*+\s*\d{4} en (.+?) el \d{2}\/\d{2}\/\d{4}/i);
  const mFecha = t.match(/el (\d{2})\/(\d{2})\/(\d{4})/);

  const fecha = mFecha ? mFecha[3] + '-' + mFecha[2] + '-' + mFecha[1] : '';
  let comercio = mCom ? limpiarComercio_(mCom[1]) : 'Compra Banco de Chile';
  let monto;
  if (mUsd) {
    // "16,50" o "1.234,56" → 16.5 / 1234.56. Se guarda en pesos al dólar observado del día.
    const usd = Number(mUsd[1].replace(/\./g, '').replace(',', '.'));
    const tc = dolarDelDia_(fecha);
    monto = String(Math.round(usd * tc.valor));
    comercio += ' (US$' + mUsd[1] + (tc.estimado ? ' · TC estimado' : '') + ')';
  } else {
    monto = mMonto[1].replace(/\./g, '');
  }
  return {
    monto: monto, fecha: fecha, comercio: comercio,
    medio: (mTipo && /d[eé]bito/i.test(mTipo[1])) || /con cargo a cuenta/i.test(t) ? 'Débito' : 'Crédito'
  };
}

/**
 * Dólar observado (mindicador.cl, gratis). Si ese día no hay valor (fin de semana/feriado) usa el último
 * publicado; si no hay conexión, el último que se guardó. { valor, estimado }
 */
function dolarDelDia_(fechaIso) {
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  const k = 'usd_' + (fechaIso || 'hoy');
  const c = cache.get(k);
  if (c) return { valor: Number(c), estimado: false };
  const urls = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaIso || '')) {
    const p = fechaIso.split('-');
    urls.push('https://mindicador.cl/api/dolar/' + p[2] + '-' + p[1] + '-' + p[0]);
  }
  urls.push('https://mindicador.cl/api/dolar');
  for (let i = 0; i < urls.length; i++) {
    try {
      const j = JSON.parse(UrlFetchApp.fetch(urls[i], { muteHttpExceptions: true }).getContentText());
      const v = j && j.serie && j.serie[0] && Number(j.serie[0].valor);
      if (v) { cache.put(k, String(v), 21600); props.setProperty('usd_ultimo', String(v)); return { valor: v, estimado: false }; }
    } catch (e) { /* sigue con la siguiente */ }
  }
  return { valor: Number(props.getProperty('usd_ultimo')) || 950, estimado: true };
}

/** Quita prefijos de pasarelas de pago: "MERPAGO*MCDONALDSCHI" → "MCDONALDSCHI". */

function crearActivador() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'revisarCorreos'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(10).create();
  Logger.log('Activador creado: revisarCorreos cada 10 minutos');
}

function procesarCorreoTransf_(msg) {
  const texto = msg.getPlainBody().replace(/\s+/g, ' ').trim();
  const de = msg.getFrom();
  const id = 'm-' + msg.getId();

  const env = /bancochile\.cl|bancoedwards\.cl/i.test(de) ? parsearTransfEnviada_(texto) : null;
  if (env) corregirComoRecibida_(id);   // versiones anteriores lo tomaban como transferencia recibida
  if (env && esInterna_(env.persona)) {
    // Traspaso a otra cuenta tuya. La descripción siempre lleva el banco de destino ("traspaso a BancoEstado"),
    // así una regla en la pestaña Reglas puede decidir según la cuenta y no según lo que escribas en el mensaje.
    const banco = nombreBanco_(env.banco);
    const desc = (env.mensaje ? env.mensaje + ' · ' : '') + 'traspaso a ' + (banco || 'cuenta propia');
    const cat = categoriaPorRegla_(desc, leerReglas_());
    agregarGasto_({
      id: id, monto: env.monto, medio: 'Transferencia', fecha: env.fecha, descripcion: desc,
      // con regla → gasto de esa categoría · sin regla y con mensaje → Pendientes · sin nada → movimiento interno
      categoria: cat || (env.mensaje ? '' : CAT_INTERNA),
      origen: cat || env.mensaje ? 'BChile traspaso' : ORIGEN_TRANSF
    });
    return true;
  }
  if (env) {
    agregarGasto_({
      id: id, monto: env.monto, medio: 'Transferencia', categoria: '', fecha: env.fecha,
      descripcion: 'Transf. a ' + env.persona + (env.mensaje ? ' · ' + env.mensaje : ''),
      origen: ORIGEN_TRANSF
    });
    return true;
  }
  const rec = parsearTransfRecibida_(texto);
  if (rec) {
    agregarTransfRecibida_({ id: id, monto: rec.monto, fecha: rec.fecha, remitente: rec.persona || 'Remitente desconocido',
                             banco: bancoDeCorreo_(de), asunto: rec.asunto,
                             estado: esInterna_(rec.persona) ? 'Interna' : '' });
    return true;
  }
  if (/\$\s*[\d.]+/.test(texto)) registrarSinProcesar_('[Transferencia] ' + msg.getSubject() + ' | ' + texto.slice(0, 500));
  return false;
}

/** Comprobante "Transferencia a terceros" de Banco de Chile / Edwards. */
function parsearTransfEnviada_(t) {
  // A terceros en Banco de Chile: "has realizado una Transferencia…"; a otros bancos: "usted ha efectuado una transferencia…"
  if (!/has realizado una Transferencia|usted ha efectuado una transferencia/i.test(t)) return null;
  const mMonto = t.match(/Monto:?\s*\$\s*([\d.]+)/i);
  if (!mMonto) return null;
  const mNom = t.match(/Nombre y Apellido:?\s+(.+?)\s+Rut\b/i) || t.match(/Destinatario:?\s+Nombre:?\s+(.+?)\s+Rut\b/i)
            || t.match(/transferencia de fondos a (.+?), el d[ií]a/i);
  const mMsg = t.match(/Mensaje:?\s+(.*?)\s*Fecha y Hora/i) || t.match(/Mensaje:?\s+(.{1,60}?)\s*(?:Si tienes|Antes de|Nota:|$)/i);
  const mBco = t.match(/Destin\w*.*?\bBanco:?\s+(.+?)\s+(?:E-?mail|Mail|Monto|Datos)\b/i);
  const mF   = t.match(/(\d{1,2}) de ([a-záéíóú]+) de (\d{4})/i);
  const mF2  = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let fecha = '';
  if (mF && MESES_ES[mF[2].toLowerCase()]) {
    fecha = mF[3] + '-' + String(MESES_ES[mF[2].toLowerCase()]).padStart(2, '0') + '-' + mF[1].padStart(2, '0');
  } else if (mF2) fecha = mF2[3] + '-' + mF2[2] + '-' + mF2[1];
  return {
    monto: mMonto[1].replace(/\./g, ''), fecha: fecha,
    persona: mNom ? mNom[1].trim() : 'destinatario',
    mensaje: mMsg ? mMsg[1].trim() : '',
    banco: mBco ? mBco[1].trim() : ''
  };
}

/**
 * Aviso del banco de quien te transfiere. Formatos conocidos (oct 2026):
 * Santander: "nuestro cliente NOMBRE realizó una transferencia a tu cuenta … Monto transferido $ 15.873"
 * Itaú:      "nuestro(a) cliente NOMBRE , ha instruido una transferencia de fondos … Monto: $20.000"
 * B. Chile:  "nuestro(a) cliente NOMBRE ha efectuado una transferencia de fondos a tu cuenta … Asunto X … Monto $9.611"
 */
function parsearTransfRecibida_(t) {
  if (!/transferencia (?:de fondos )?a tu cuenta|ha (?:instruido|efectuado) una transferencia|te (ha )?transferid|te transfiri[oó]|transferencia recibida/i.test(t)) return null;
  if (/has realizado una Transferencia|usted ha efectuado una transferencia/i.test(t)) return null;   // son enviadas
  const mMonto = t.match(/Monto(?: transferido| abonado| recibido| a transferir)?\s*:?\s*(?:CLP\s*)?\$\s*([\d.]+)/i)
              || t.match(/Monto[^$\d]{0,40}\$\s*([\d.]+)/i)
              || t.match(/Monto(?: transferido| abonado| recibido)?\s*:?\s*(\d{1,3}(?:\.\d{3})+|\d+)\b/i);
  if (!mMonto) return null;
  const mFecha = t.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  const mNom = t.match(/nuestro\s*\(?a?\)?\s+cliente\s+(.+?)\s*,?\s+(?:realiz[oó]|ha realizado|ha instruido|ha efectuado|te )/i);
  // Asunto o mensaje que escribió quien transfiere (ej. "Micherey"), si viene
  const mAs = t.match(/(?:Asunto|Mensaje)\s*:?\s+(.{1,40}?)\s+(?:Datos de|Nombre|Monto|Rut|Banco|Fecha|N[uú]mero|Email|Cuenta)\b/i);
  const asunto = mAs && !/antes de imprimir|importante|^itau/i.test(mAs[1]) ? mAs[1].trim() : '';
  return {
    monto: mMonto[1].replace(/\./g, ''),
    fecha: mFecha ? mFecha[3] + '-' + mFecha[2] + '-' + mFecha[1] : '',
    persona: mNom ? mNom[1].trim() : '',
    asunto: asunto
  };
}

function bancoDeCorreo_(de) {
  const d = String(de).toLowerCase();
  const B = [['santander', 'Santander'], ['itau', 'Itaú'], ['bci', 'BCI'], ['bancoestado', 'BancoEstado'],
             ['scotiabank', 'Scotiabank'], ['bancochile', 'Banco de Chile'], ['bancoedwards', 'Banco de Chile'],
             ['falabella', 'Falabella'], ['ripley', 'Ripley'], ['security', 'Security'], ['bice', 'BICE'],
             ['mercadopago', 'Mercado Pago'], ['tenpo', 'Tenpo'], ['machbank', 'MACH'], ['consorcio', 'Consorcio']];
  for (let i = 0; i < B.length; i++) if (d.indexOf(B[i][0]) !== -1) return B[i][1];
  const m = d.match(/@([^.>]+)/);
  return m ? m[1] : 'Otro banco';
}

/* ---------- Recuperación (ejecutar desde el editor) ---------- */

/**
 * Ejecútala UNA vez después de pegar esta versión: vuelve a leer los correos que quedaron en
 * Notif_sin_procesar por formatos que antes no se entendían (compras en US$ y transferencias).
 * Solo agrega lo que no existe (mismo ID de correo), así que no duplica nada.
 */
function reprocesarCorreos() {
  const q = 'label:' + LABEL_PROCESADO + ' after:' + correoDesde_() +
            ' ("US$" OR "ha instruido una transferencia" OR "ha efectuado una transferencia" OR "transferencia a tu cuenta" OR ' +
            '"transferencia de fondos a tu cuenta" OR "te ha transferido" OR "te transfirió")';
  let n = 0;
  GmailApp.search(q, 0, 100).forEach(function (hilo) {
    hilo.getMessages().forEach(function (msg) {
      const texto = msg.getPlainBody().replace(/\s+/g, ' ').trim();
      if (/compra por US\$/i.test(texto) && /bancochile|bancoedwards/i.test(msg.getFrom())) {
        const p = parsearBChile_(texto);
        if (p && agregarGasto_({ id: 'm-' + msg.getId(), monto: p.monto, descripcion: p.comercio, medio: p.medio,
                                  categoria: '', fecha: p.fecha, origen: 'BChile auto' }) === 'ok') n++;
      } else if (/transferencia/i.test(texto)) {
        procesarCorreoTransf_(msg); n++;
      }
    });
  });
  Logger.log('Correos revisados y agregados (los que ya estaban se saltan): ' + n);
}


/**
 * Ejecútala después de liberar espacio: reintenta las notificaciones en respaldo y lee
 * todos los correos que quedaron sin procesar (varias pasadas, 30 hilos cada una).
 */
function recuperar() {
  Logger.log('Respaldo: ' + JSON.stringify(reintentarRespaldo_()));
  for (let k = 0; k < 6; k++) revisarCorreos();
  Logger.log('Listo. Revisa Pendientes en la app y la pestaña ' + SHEET_ERR + '.');
}

function probarTransferencias() {
  Logger.log(JSON.stringify(parsearTransfEnviada_('Te informamos que has realizado una Transferencia a terceros en forma ' +
    'exitosa con el siguiente detalle: Destino Nombre y Apellido Ana Pérez Rut 1-9 Monto $5.000 Mensaje ' +
    'Fecha y Hora: lunes 19 de octubre de 2026 19:50')));
  Logger.log(JSON.stringify(parsearTransfRecibida_('Informamos que con fecha 09/10/2026-15:42:22, nuestro(a) cliente ' +
    'JUAN ANDRES SOTO DIAZ , ha instruido una transferencia de fondos con el siguiente detalle: Monto: $20.000')));
}

function probarCorreoParser() {
  const r = parsearBChile_('Hola: Te informamos que se ha realizado una compra por $58.960 con ' +
    'Tarjeta de Crédito ****5678 en MERPAGO*MCDONALDSCHI el 04/10/2026 17:41. Revisa Saldos...');
  Logger.log(JSON.stringify(r)); // esperado: monto 58960, comercio MCDONALDSCHI, fecha 2026-10-04
}

function correoDesde_() {
  if (CORREO_DESDE) return CORREO_DESDE;
  const props = PropertiesService.getScriptProperties();
  let f = props.getProperty('correo_desde');
  if (!f) { f = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd'); props.setProperty('correo_desde', f); }
  return f;
}

/** Lee cada 10 minutos los correos de compra y transferencias (hoy: Banco de Chile / Edwards y transferencias recibidas). */
function activarCorreos() {
  correoDesde_();
  crearActivador();
  avisar_('Lectura de correos activada desde ' + correoDesde_() + '. Revisa cada 10 minutos.');
}

function desactivarCorreos() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'revisarCorreos'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  avisar_('Lectura de correos desactivada.');
}
