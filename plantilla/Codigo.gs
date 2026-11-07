/**
 * Registrar Gasto — API (Apps Script) · PLANTILLA para compartir
 *
 * ARCHIVOS: este (obligatorio) + Correos.gs (opcional: lectura automática de correos del banco).
 *   Sin Correos.gs la app funciona igual con registro manual, y Google no pide acceso a tu Gmail.
 *
 * CÓMO INSTALARLO (resumen; la guía completa está en plantilla/LEEME.md del repo):
 *   1. Sube Gastos-plantilla.xlsx a tu Drive y ábrelo como Hoja de cálculo de Google.
 *   2. En esa hoja: Extensiones → Apps Script. Borra lo que haya y pega este archivo completo.
 *   3. Edita la sección "TUS DATOS" (abajo) y guarda.
 *   4. Vuelve a la hoja, recarga la página y usa el menú "Gastos → Configurar".
 *   5. En Apps Script: Implementar → Nueva implementación → Aplicación web
 *      (Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario). Copia la URL que termina en /exec.
 *   6. Menú "Gastos → Ver clave de la app". En la app: engranaje → pega la URL y la clave.
 *
 *
 * Pestaña Gastos:  A Fecha | B Descripción | C Monto | D Medio | E Categoría | F Registrado | G ID | H Origen | I Mes
 *   I Mes (opcional, yyyy-MM) = mes del presupuesto al que cuenta. Vacío = automático: un gasto fijo pagado
 *   desde el día 20 (ya con el sueldo nuevo) cuenta para el mes siguiente; el resto, para el mes de su fecha.
 * Pestaña Deudas:  A Fecha | B Persona | C Tipo | D Monto | E Detalle | F Estado | G ID | H ID gasto | I Registrado
 *   Tipo:   Me debe | Le debo | Me pagó | Le pagué
 *   Estado: Pendiente | Pagado | Perdonado
 *   "Me debe" con ID gasto = parte de un gasto dividido: se descuenta de ese gasto en el resumen,
 *   salvo que esté Perdonado (ahí vuelve a contar como gasto tuyo).
 * Pestaña Presupuesto:  A Mes ("base" o yyyy-MM) | B Categoría | C Monto
 *   "base" se repite todos los meses; las filas de un mes puntual reemplazan solo esas categorías.
 *   Categorías especiales: _Ingreso y _Ahorro.
 * Pestaña Ingresos:  A Fecha | B Descripción | C Monto | D Tipo | E Categoría | F Mes | G Registrado | H ID
 *   Tipo: Ingreso | Ahorro.  Mes (yyyy-MM) = mes del presupuesto al que cuenta: un sueldo recibido
 *   desde el día 20 financia el mes siguiente.
 * Pestaña Transferencias (recibidas):  A Fecha | B Remitente | C Monto | D Banco | E Estado | F ID | G Registrado
 *   Estado vacío = pendiente en la app. Al resolverla queda "Deuda: <persona>", "Ingreso" o "Descartada".
 * Pestaña Alias:  A Nombre en el banco | B Persona en Deudas, o "_Ahorro: <categoría>" para destinos de ahorro
 *   (Racional, Fintual…). Se llena sola al confirmar una transferencia.
 * Categorías que empiezan con "_" (_Préstamo, _Pago deuda, _Ahorro, _Interna, _Descartado) NO cuentan como gasto.
 * Cuotas: una compra en N cuotas se guarda como N filas (una por mes) con ID  <id>, <id>-c2, <id>-c3…
 */

/* ======================= TUS DATOS (edítalos) ======================= */

// Tu nombre como lo escriben los bancos. Una transferencia desde o hacia una persona cuyo nombre
// contiene TODAS estas palabras se toma como traspaso entre tus cuentas (no es gasto ni ingreso).
// Déjalo vacío [] si no quieres esa detección.
const TITULAR = ['nombre', 'apellido'];

// Medios de pago y categorías que verás en la app. Cámbialos a tu gusto.
// Ojo: las categorías que empiezan con "_" están reservadas (no cuentan como gasto).
/* ---------- Entradas HTTP ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!claveValida_(p.key)) return json_({ ok: false, error: 'Clave incorrecta' });
  try {
    if (p.action === 'config')     return json_({ ok: true, medios: MEDIOS, categorias: CATEGORIAS,
                                                  categoriasIngreso: CAT_INGRESO, categoriasAhorro: CAT_AHORRO });
    if (p.action === 'pendientes') return json_({ ok: true, items: listarPendientes_(), personas: personasConSaldo_() });
    if (p.action === 'resumen')    return json_(Object.assign({ ok: true }, resumenMes_(p.mes)));
    if (p.action === 'deudas')     return json_({ ok: true, items: listarDeudas_() });
    if (p.action === 'movimientos') return json_({ ok: true, items: listarMovimientos_() });
    if (p.action === 'tendencias') return json_(Object.assign({ ok: true }, tendencias_(p.meses)));
    if (p.action === 'presupuesto') return json_(Object.assign({ ok: true }, presupuestoMes_(p.mes)));
    return json_({ ok: true, msg: 'API activa' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  if (!claveValida_(d.key)) return json_({ ok: false, error: 'Clave incorrecta' });

  try {
    if (d.action === 'gasto' && (d.tipo === 'Ingreso' || d.tipo === 'Ahorro')) {
      return json_({ ok: true, duplicado: agregarIngreso_(d) === 'dup' });
    }
    if (d.action === 'gasto') {
      d.origen = 'Manual';
      const res = agregarGasto_(d);
      return json_({ ok: true, duplicado: res === 'dup' });
    }
    if (d.action === 'notif')        return json_(procesarNotif_(String(d.texto || '')));
    if (d.action === 'categorizar')  return json_(categorizar_(d));
    if (d.action === 'descartar')    return json_(descartar_(d));
    if (d.action === 'resolver_transf') return json_(resolverTransf_(d));
    if (d.action === 'deuda')        return json_(nuevaDeuda_(d));
    if (d.action === 'abono')        return json_(abonar_(d));
    if (d.action === 'saldar')       return json_(saldar_(d));
    if (d.action === 'deuda_estado') return json_(estadoDeuda_(d));
    if (d.action === 'presupuesto')  return json_(guardarPresupuesto_(d));
    if (d.action === 'editar')       return json_(editarGasto_(d));
    if (d.action === 'eliminar')     return json_(eliminarGasto_(d));
    return json_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ---------- Notificaciones del banco ---------- */

/**
 * Formato Santander (oct 2026):
 * "El 01-10-2026 14:01:28 se realizó una compra con tu Tarjeta de Crédito
 *  terminada en 1234 en COMERCIALIZADORA Y DIS por $ 1.600. Si desconoces..."
 */
function procesarNotif_(texto) {
  texto = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!texto) return { ok: false, error: 'Texto vacío' };
  try {
    return procesarNotifCore_(texto);
  } catch (err) {
    // El Sheet no se pudo escribir (ej. almacenamiento lleno): se guarda en las propiedades
    // del script, que no ocupan espacio de Drive, y revisarCorreos (Correos.gs) la reintenta cada 10 min; sin Correos.gs, ejecuta reintentarRespaldo_ a mano.
    guardarEnRespaldo_(texto);
    return { ok: true, procesado: false, enRespaldo: true, error: String(err.message || err) };
  }
}

function procesarNotifCore_(texto) {
  // ID = huella del texto: si Android dispara la misma notificación 2 veces, no se duplica.
  const id = 'n-' + hash_(texto);

  const p = parsearSantander_(texto);
  if (!p) {
    // No calza con el formato conocido: se guarda aparte para revisar, sin ensuciar Gastos.
    if (/\$\s*[\d.]+/.test(texto)) registrarSinProcesar_(texto);
    return { ok: true, procesado: false };
  }

  const res = agregarGasto_({
    id: id,
    monto: p.monto,
    descripcion: p.comercio,
    medio: p.medio,
    categoria: '',            // vacía = pendiente de categorizar
    fecha: p.fecha,
    origen: 'Santander auto'
  });
  if (p.sinComercio) registrarSinProcesar_('[Santander sin comercio] ' + texto);
  return { ok: true, procesado: true, duplicado: res === 'dup' };
}

/**
 * Formatos Santander conocidos (oct 2026):
 * A: "El 01-10-2026 14:01:28 se realizó una compra con tu Tarjeta de Crédito terminada en 1234 en COMERCIO por $ 1.600. …"
 * B: "Transacción por $ 576. se realizó una compra con tu Tarjeta de Crédito ****1234 en COMERCIO, el 21-10-2026 a las 17:48:10."
 * El comercio es lo que va después del número de tarjeta, hasta " por $", ", el <fecha>" o el punto final.
 */
function parsearSantander_(t) {
  if (!/se realiz[oó] una compra/i.test(t)) return null;

  const mMonto = t.match(/\$\s*(\d[\d.]*\d|\d)/);
  if (!mMonto) return null;
  const mFecha = t.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  const mTipo  = t.match(/Tarjeta de (Cr[eé]dito|D[eé]bito)/i);

  const mCom = t.match(/[\*X\d]{4,}\s+en\s+(.+?),?\s+el\s+\d{2}[-\/]\d{2}[-\/]\d{4}/i)   // formato B
            || t.match(/[\*X\d]{4,}\s+en\s+(.+?)\s+por\s+\$/i)                          // formato A
            || t.match(/[\*X\d]{4,}\s+en\s+(.+?)(?:\.\s|\.?$)/i);
  let comercio = mCom ? mCom[1].trim().replace(/[,.]$/, '') : '';
  if (/^[\*X\d\s]+$/i.test(comercio) || /tarjeta/i.test(comercio)) comercio = '';

  return {
    monto: mMonto[1].replace(/\./g, ''),
    fecha: mFecha ? mFecha[3] + '-' + mFecha[2] + '-' + mFecha[1] : '',
    comercio: comercio ? limpiarComercio_(comercio) : 'Compra Santander',
    sinComercio: !comercio,
    medio: mTipo && /d[eé]bito/i.test(mTipo[1]) ? 'Débito' : 'Crédito'
  };
}

/**
 * Ejecútala UNA vez: corrige los gastos que quedaron como "Compra Santander" usando el texto
 * guardado en Notif_sin_procesar (filas "[Santander sin comercio] …"). Mismo ID → misma fila.
 */
function corregirComprasSantander() {
  const ss = libro_();
  const err = ss.getSheetByName(SHEET_ERR);
  if (!err || err.getLastRow() < 2) { Logger.log('No hay notificaciones guardadas'); return; }
  const sh = hojaGastos_();
  let ok = 0;
  err.getRange(2, 2, err.getLastRow() - 1, 1).getValues().forEach(function (r) {
    const m = String(r[0]).match(/^\[Santander sin comercio\]\s*(.+)$/);
    if (!m) return;
    const texto = m[1].trim();
    const p = parsearSantander_(texto);
    if (!p || p.sinComercio) return;
    const fila = buscarFila_(sh, 'n-' + hash_(texto));
    if (fila && String(sh.getRange(fila, COL.DESC).getValue()) === 'Compra Santander') {
      sh.getRange(fila, COL.DESC).setValue(p.comercio);
      if (!String(sh.getRange(fila, COL.CAT).getValue()).trim()) {
        const c = categoriaPorRegla_(p.comercio, leerReglas_());
        if (c) sh.getRange(fila, COL.CAT).setValue(c);
      }
      ok++;
    }
  });
  Logger.log('Gastos corregidos: ' + ok);
}

/* ---------- Respaldo cuando el Sheet no se puede escribir ---------- */

const PREF_RESPALDO = 'respaldo_n_';

function guardarEnRespaldo_(texto) {
  try {
    PropertiesService.getScriptProperties().setProperty(PREF_RESPALDO + hash_(texto), texto.slice(0, 8000));
  } catch (e) { /* si ni esto funciona, no hay nada más que hacer */ }
}

/** Reintenta las notificaciones que no se pudieron guardar. La llama revisarCorreos. */
function reintentarRespaldo_() {
  const props = PropertiesService.getScriptProperties();
  const todas = props.getProperties();
  let ok = 0, quedan = 0;
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(PREF_RESPALDO) !== 0) return;
    try { procesarNotifCore_(todas[k]); props.deleteProperty(k); ok++; }
    catch (e) { quedan++; }
  });
  return { recuperadas: ok, quedan: quedan };
}

function registrarSinProcesar_(texto) {
  const ss = libro_();
  const sh = ss.getSheetByName(SHEET_ERR) || ss.insertSheet(SHEET_ERR);
  if (sh.getLastRow() === 0) sh.appendRow(['Recibido', 'Texto']);
  sh.appendRow([new Date(), texto]);
}

/* ---------- Pendientes ---------- */

const COL = { FECHA: 1, DESC: 2, MONTO: 3, MEDIO: 4, CAT: 5, REG: 6, ID: 7, ORIGEN: 8, MES: 9 };

function hojaGastos_() {
  const sh = libro_().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('No encuentro la pestaña "' + SHEET_NAME + '"');
  return sh;
}

function isoFecha_(f, tz) {
  if (f instanceof Date) return Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  const s = String(f || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * Pendientes de la app, de la más reciente a la más antigua:
 * - Gastos con ID y sin categoría (compras y transferencias enviadas).
 * - Transferencias recibidas sin resolver (clase "recibida").
 * Las transferencias traen la persona sugerida de Deudas.
 */
function listarPendientes_() {
  const sh = hojaGastos_();
  const n = sh.getLastRow();
  const tz = Session.getScriptTimeZone();
  const personas = personasConSaldo_();
  const alias = leerAlias_();

  const gastos = n < 2 ? [] : sh.getRange(2, 1, n - 1, 8).getValues()
    .filter(function (r) { return r[COL.ID - 1] && !String(r[COL.CAT - 1]).trim(); })
    .map(function (r) {
      const it = {
        clase: 'gasto',
        id: String(r[COL.ID - 1]),
        fecha: isoFecha_(r[COL.FECHA - 1], tz),
        descripcion: String(r[COL.DESC - 1]),
        monto: Number(r[COL.MONTO - 1]) || 0,
        medio: String(r[COL.MEDIO - 1]),
        origen: String(r[COL.ORIGEN - 1])
      };
      if (it.origen === ORIGEN_TRANSF) {
        it.clase = 'enviada';
        it.persona = personaDeDescripcion_(it.descripcion);
        const a = alias[sinTildes_(it.persona)] || '';
        if (a.indexOf(PREF_AHORRO) === 0) it.ahorro = a.slice(PREF_AHORRO.length).trim();   // destino de ahorro conocido
        else it.sugerida = sugerirPersona_(it.persona, personas, alias, -1);
      }
      return it;
    });

  const recibidas = leerTransfRecibidas_()
    .filter(function (x) { return !x.estado; })
    .map(function (x) {
      return {
        clase: 'recibida', id: x.id, fecha: x.fecha, monto: x.monto,
        descripcion: 'Transferencia de ' + nombrePropio_(x.remitente) + (x.asunto ? ' · ' + x.asunto : ''),
        persona: x.remitente, medio: 'Transferencia', origen: x.banco,
        sugerida: sugerirPersona_(x.remitente, personas, alias, 1)
      };
    });

  return gastos.concat(recibidas).sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
}

function buscarFila_(sh, id, col) {
  const n = sh.getLastRow();
  if (n < 2) return 0;
  const c = sh.getRange(2, col || COL.ID, n - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return c ? c.getRow() : 0;
}

/** { id, categoria, recordar, patron, division:{persona, monto} (opcional) } */
function categorizar_(d) {
  if (!d.id || !d.categoria) throw new Error('Faltan datos');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = hojaGastos_();
    const fila = buscarFila_(sh, d.id);
    if (!fila) throw new Error('No encontré ese gasto (¿lo borraste del Sheet?)');
    sh.getRange(fila, COL.CAT).setValue(d.categoria);
    // Nombre corregido desde Pendientes (antes de crear deudas o cuotas, que lo copian)
    if (d.descripcion && String(d.descripcion).trim()) sh.getRange(fila, COL.DESC).setValue(String(d.descripcion).trim());

    if (divisiones_(d.division).length) {
      const r = sh.getRange(fila, 1, 1, 8).getValues()[0];
      crearDeudasDeGasto_(d.id, d.division, String(r[COL.DESC - 1]), isoFecha_(r[COL.FECHA - 1], Session.getScriptTimeZone()));
    }

    if (Number(d.cuotas) > 1) repartirCuotas_(sh, fila, Number(d.cuotas));

    let aplicadas = 0;
    const patron = String(d.patron || '').trim();
    if (d.recordar && patron) {
      guardarRegla_(patron, d.categoria);
      aplicadas = aplicarReglasAPendientes_(sh);
    }
    return { ok: true, aplicadas: aplicadas };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Para compras duplicadas o que no son gasto (ej. pago de la tarjeta).
 * No borra la fila: la marca "_Descartado" para que, si el banco reenvía el mismo correo,
 * no vuelva a aparecer en Pendientes. Las categorías "_" no cuentan como gasto.
 */
function descartar_(d) {
  if (!d.id) throw new Error('Falta el ID');
  return conLock_(function () {
    const shT = hojaTransf_();
    const ft = buscarFila_(shT, d.id, TCOL.ID);
    if (ft) { shT.getRange(ft, TCOL.ESTADO).setValue('Descartada'); return { ok: true }; }
    const sh = hojaGastos_();
    const fila = buscarFila_(sh, d.id);
    if (fila) sh.getRange(fila, COL.CAT).setValue('_Descartado');
    return { ok: true };
  });
}

/* ---------- Reglas ---------- */

function hojaReglas_() {
  const ss = libro_();
  let sh = ss.getSheetByName(SHEET_REGLAS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_REGLAS);
    sh.appendRow(['Contiene', 'Categoría']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function leerReglas_() {
  const sh = hojaReglas_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 2).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim(); })
    .map(function (r) { return { p: String(r[0]).toUpperCase().trim(), c: String(r[1]).trim() }; })
    // la regla más específica (más larga) gana
    .sort(function (a, b) { return b.p.length - a.p.length; });
}

function categoriaPorRegla_(desc, reglas) {
  const D = String(desc || '').toUpperCase();
  for (let i = 0; i < reglas.length; i++) {
    if (D.indexOf(reglas[i].p) !== -1) return reglas[i].c;
  }
  return '';
}

/** Crea la regla o actualiza su categoría si ya existía. */
function guardarRegla_(patron, categoria) {
  const sh = hojaReglas_();
  const P = patron.toUpperCase().trim();
  const n = sh.getLastRow();
  if (n >= 2) {
    const vals = sh.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).toUpperCase().trim() === P) {
        sh.getRange(i + 2, 2).setValue(categoria);
        return;
      }
    }
  }
  sh.appendRow([P, categoria]);
}

/** Aplica las reglas a todo lo que siga pendiente. Devuelve cuántas filas categorizó. */
function aplicarReglasAPendientes_(sh) {
  const reglas = leerReglas_();
  const n = sh.getLastRow();
  if (n < 2 || !reglas.length) return 0;
  const vals = sh.getRange(2, 1, n - 1, 8).getValues();
  let cont = 0;
  vals.forEach(function (r, i) {
    if (r[COL.ID - 1] && !String(r[COL.CAT - 1]).trim()) {
      const c = categoriaPorRegla_(r[COL.DESC - 1], reglas);
      if (c) { sh.getRange(i + 2, COL.CAT).setValue(c); cont++; }
    }
  });
  return cont;
}

/* ---------- Escritura en Gastos ---------- */

function agregarGasto_(d) {
  if (d.id && buscarFila_(hojaGastos_(), d.id)) return { ok: true, duplicado: true };
  const monto = Number(String(d.monto).replace(/\D/g, ''));
  if (!monto || monto <= 0) throw new Error('Monto inválido');

  const cache = CacheService.getScriptCache();
  if (d.id && cache.get('id_' + d.id)) return 'dup';

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (d.id && cache.get('id_' + d.id)) return 'dup';

    const sheet = libro_().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('No encuentro la pestaña "' + SHEET_NAME + '"');

    // Gastos automáticos sin categoría: se intenta con las Reglas.
    if (!d.categoria && d.origen && d.origen !== 'Manual') {
      d.categoria = categoriaPorRegla_(d.descripcion, leerReglas_());
    }

    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')
      ? new Date(d.fecha + 'T12:00:00')
      : new Date();

    sheet.appendRow([
      fecha,                       // A Fecha
      String(d.descripcion || ''), // B Descripción
      monto,                       // C Monto
      String(d.medio || ''),       // D Medio
      String(d.categoria || ''),   // E Categoría
      new Date(),                  // F Registrado
      String(d.id || ''),          // G ID
      String(d.origen || '')       // H Origen
    ]);

    if (Number(d.cuotas) > 1) repartirCuotas_(sheet, sheet.getLastRow(), Number(d.cuotas));

    // Gasto dividido desde el wizard: se crea la deuda en el mismo envío (funciona aunque haya salido sin señal).
    if (d.id && divisiones_(d.division).length) {
      crearDeudasDeGasto_(d.id, d.division, String(d.descripcion || d.categoria || 'Gasto dividido'), d.fecha);
    }

    if (d.id) cache.put('id_' + d.id, '1', 21600); // 6 horas
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Deudas entre personas ---------- */

const DCOL = { FECHA: 1, PERSONA: 2, TIPO: 3, MONTO: 4, DETALLE: 5, ESTADO: 6, ID: 7, IDGASTO: 8, REG: 9 };
const TIPOS_DEUDA = { 'Me debe': 1, 'Le pagué': 1, 'Le debo': -1, 'Me pagó': -1 }; // signo: + = a tu favor

function hojaDeudas_() {
  const ss = libro_();
  let sh = ss.getSheetByName(SHEET_DEUDAS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_DEUDAS);
    sh.appendRow(['Fecha', 'Persona', 'Tipo', 'Monto', 'Detalle', 'Estado', 'ID', 'ID gasto', 'Registrado']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function leerDeudas_() {
  const sh = hojaDeudas_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, n - 1, 9).getValues()
    .map(function (r, i) {
      return {
        fila: i + 2,
        fecha: isoFecha_(r[DCOL.FECHA - 1], tz),
        persona: String(r[DCOL.PERSONA - 1]).trim(),
        tipo: String(r[DCOL.TIPO - 1]).trim(),
        monto: Math.round(Number(r[DCOL.MONTO - 1]) || 0),
        detalle: String(r[DCOL.DETALLE - 1]),
        estado: String(r[DCOL.ESTADO - 1]).trim() || 'Pendiente',
        id: String(r[DCOL.ID - 1]),
        idGasto: String(r[DCOL.IDGASTO - 1])
      };
    })
    .filter(function (x) { return x.persona && x.monto && TIPOS_DEUDA[x.tipo]; });
}

function listarDeudas_() {
  return leerDeudas_()
    .map(function (x) { delete x.fila; return x; })
    .sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
}

function mismaPersona_(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }

/** Escribe una fila en Deudas. No toma el lock (lo hace quien la llama). */
function agregarDeuda_(d) {
  const monto = Math.round(Number(String(d.monto).replace(/[^\d]/g, '')));
  const persona = String(d.persona || '').trim();
  if (!persona) throw new Error('Falta la persona');
  if (!monto || monto <= 0) throw new Error('Monto inválido');
  if (!TIPOS_DEUDA[d.tipo]) throw new Error('Tipo inválido');

  const sh = hojaDeudas_();
  if (d.id && buscarFila_(sh, d.id, DCOL.ID)) return 'dup';

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? new Date(d.fecha + 'T12:00:00') : new Date();
  sh.appendRow([
    fecha, persona, d.tipo, monto, String(d.detalle || ''),
    d.estado || 'Pendiente', String(d.id || ('x-' + Utilities.getUuid())), String(d.idGasto || ''), new Date()
  ]);
  return 'ok';
}

/** Acepta una persona {persona, monto} (versión anterior de la app) o una lista de ellas. */
function divisiones_(div) {
  return [].concat(div || []).filter(function (x) { return x && String(x.persona || '').trim() && Number(x.monto) > 0; });
}

/** Una deuda "Me debe" por persona, todas ligadas al mismo gasto. IDs: d-<gasto>, d-<gasto>-2, d-<gasto>-3… */
function crearDeudasDeGasto_(idGasto, division, detalle, fecha) {
  divisiones_(division).forEach(function (x, k) {
    agregarDeuda_({
      id: 'd-' + idGasto + (k ? '-' + (k + 1) : ''), idGasto: idGasto, tipo: 'Me debe',
      persona: x.persona, monto: x.monto, detalle: detalle, fecha: fecha
    });
  });
}

/** { tipo:'Me debe'|'Le debo', persona, monto, detalle, fecha, id } */
function nuevaDeuda_(d) {
  if (d.tipo !== 'Me debe' && d.tipo !== 'Le debo') throw new Error('Tipo inválido');
  return conLock_(function () { return { ok: true, res: agregarDeuda_(d) }; });
}

function saldoPersona_(filas, persona) {
  return filas.reduce(function (s, x) {
    return (x.estado === 'Pendiente' && mismaPersona_(x.persona, persona)) ? s + TIPOS_DEUDA[x.tipo] * x.monto : s;
  }, 0);
}

function cerrarPendientes_(persona) {
  const sh = hojaDeudas_();
  leerDeudas_().forEach(function (x) {
    if (x.estado === 'Pendiente' && mismaPersona_(x.persona, persona)) sh.getRange(x.fila, DCOL.ESTADO).setValue('Pagado');
  });
}

/** Pago parcial. { persona, monto, fecha, id } — el sentido se deduce del saldo. */
function abonar_(d) {
  return conLock_(function () {
    const saldo = saldoPersona_(leerDeudas_(), d.persona);
    if (!saldo) throw new Error('No hay saldo pendiente con ' + d.persona);
    const monto = Math.round(Number(String(d.monto).replace(/[^\d]/g, '')));
    if (monto > Math.abs(saldo)) throw new Error('El pago supera el saldo pendiente');
    agregarDeuda_({
      id: d.id, persona: d.persona, monto: monto, fecha: d.fecha,
      tipo: saldo > 0 ? 'Me pagó' : 'Le pagué', detalle: d.detalle || 'Pago parcial'
    });
    const quedo = saldoPersona_(leerDeudas_(), d.persona);
    if (quedo === 0) cerrarPendientes_(d.persona);
    return { ok: true, saldo: quedo };
  });
}

/** Salda todo con una persona: registra el pago por el saldo y cierra lo pendiente. { persona, fecha } */
function saldar_(d) {
  return conLock_(function () {
    const saldo = saldoPersona_(leerDeudas_(), d.persona);
    if (saldo) {
      agregarDeuda_({
        persona: d.persona, monto: Math.abs(saldo), fecha: d.fecha,
        tipo: saldo > 0 ? 'Me pagó' : 'Le pagué', detalle: 'Saldó todo', estado: 'Pagado'
      });
    }
    cerrarPendientes_(d.persona);
    return { ok: true };
  });
}

/** Cambia el estado de una fila: Perdonado, Pagado o Pendiente (reabrir). { id, estado } */
function estadoDeuda_(d) {
  if (['Pendiente', 'Pagado', 'Perdonado'].indexOf(d.estado) === -1) throw new Error('Estado inválido');
  return conLock_(function () {
    const sh = hojaDeudas_();
    const fila = buscarFila_(sh, d.id, DCOL.ID);
    if (!fila) throw new Error('No encontré ese movimiento');
    sh.getRange(fila, DCOL.ESTADO).setValue(d.estado);
    return { ok: true };
  });
}

function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- Compras en cuotas ---------- */

/**
 * Convierte la fila en la cuota 1/N y agrega las cuotas 2..N en los meses siguientes (mismo día).
 * Si el total no es divisible, la diferencia queda en la primera cuota.
 */
function repartirCuotas_(sh, fila, n) {
  n = Math.min(Math.max(Math.round(n), 2), 48);
  const r = sh.getRange(fila, 1, 1, 8).getValues()[0];
  const id = String(r[COL.ID - 1] || '');
  if (!id || /-c\d+$/.test(id) || buscarFila_(sh, id + '-c2')) return; // ya repartida
  const total = Number(r[COL.MONTO - 1]) || 0;
  if (!total) return;

  const cuota = Math.floor(total / n);
  const desc = String(r[COL.DESC - 1]);
  const f0 = r[COL.FECHA - 1] instanceof Date ? r[COL.FECHA - 1] : new Date();

  sh.getRange(fila, COL.MONTO).setValue(total - cuota * (n - 1));
  sh.getRange(fila, COL.DESC).setValue(desc + ' (1/' + n + ')');

  const nuevas = [];
  for (let k = 2; k <= n; k++) {
    nuevas.push([sumarMeses_(f0, k - 1), desc + ' (' + k + '/' + n + ')', cuota, r[COL.MEDIO - 1],
                 r[COL.CAT - 1], new Date(), id + '-c' + k, r[COL.ORIGEN - 1]]);
  }
  sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, 8).setValues(nuevas);
}

function sumarMeses_(f, m) {
  const d = new Date(f.getFullYear(), f.getMonth() + m, 1, 12);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(f.getDate(), ultimo));
  return d;
}

/* ---------- Gastos "efectivos" (descontando lo que te deben) ---------- */

/**
 * Todas las filas de Gastos con su monto efectivo: el cargo menos la parte que otra persona te debe.
 * La deuda se reparte proporcionalmente entre las cuotas de la misma compra.
 */
function gastosEfectivos_() {
  const tz = Session.getScriptTimeZone();
  const compartido = {};
  leerDeudas_().forEach(function (x) {
    if (x.idGasto && x.tipo === 'Me debe' && x.estado !== 'Perdonado') {
      compartido[x.idGasto] = (compartido[x.idGasto] || 0) + x.monto;
    }
  });

  const sh = hojaGastos_();
  const n = sh.getLastRow();
  const filas = n < 2 ? [] : sh.getRange(2, 1, n - 1, 9).getValues();

  const totalGrupo = {};
  const lista = filas.map(function (r) {
    const id = String(r[COL.ID - 1] || '');
    const base = id.replace(/-c\d+$/, '');
    const bruto = Number(r[COL.MONTO - 1]) || 0;
    if (base) totalGrupo[base] = (totalGrupo[base] || 0) + bruto;
    const reg = r[COL.REG - 1];
    return {
      id: id, base: base, fecha: isoFecha_(r[COL.FECHA - 1], tz), bruto: bruto,
      descripcion: String(r[COL.DESC - 1]), medio: String(r[COL.MEDIO - 1]),
      categoria: String(r[COL.CAT - 1]).trim(), origen: String(r[COL.ORIGEN - 1] || ''),
      reg: reg instanceof Date ? reg.getTime() : 0, mesFijo: mesCelda_(r[COL.MES - 1], tz)
    };
  });
  lista.forEach(function (g) { g.mes = g.mesFijo || mesGasto_(g.fecha, g.categoria); });

  lista.forEach(function (g) {
    const c = g.base && compartido[g.base] ? compartido[g.base] * g.bruto / totalGrupo[g.base] : 0;
    g.monto = Math.max(0, Math.round(g.bruto - c));
  });
  // Categorías "_" (préstamos, pagos de deuda, descartados) no son gasto.
  return lista.filter(function (g) { return g.bruto && g.categoria.charAt(0) !== '_'; });
}

/* ---------- Presupuesto ---------- */

function hojaPresupuesto_() {
  const ss = libro_();
  let sh = ss.getSheetByName(SHEET_PRES);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PRES);
    sh.appendRow(['Mes', 'Categoría', 'Monto']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function leerPresupuesto_() {
  const sh = hojaPresupuesto_();
  const n = sh.getLastRow();
  const out = { base: {}, meses: {} };
  if (n < 2) return out;
  const tz = Session.getScriptTimeZone();
  sh.getRange(2, 1, n - 1, 3).getValues().forEach(function (r) {
    let mes = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM') : String(r[0]).trim();
    const cat = String(r[1]).trim();
    if (!mes || !cat) return;
    const v = Math.round(Number(r[2]) || 0);
    if (mes === 'base') out.base[cat] = v;
    else (out.meses[mes] = out.meses[mes] || {})[cat] = v;
  });
  return out;
}

/** Presupuesto del mes (base + ajustes del mes) y lo gastado por categoría. */
function presupuestoMes_(mes) {
  const tz = Session.getScriptTimeZone();
  if (!/^\d{4}-\d{2}$/.test(mes || '')) mes = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const P = leerPresupuesto_();
  const ajustes = P.meses[mes] || {};

  const gastado = {};
  gastosEfectivos_().forEach(function (g) {
    if (g.mes !== mes || !g.monto) return;
    const k = g.categoria || 'Sin categoría';
    gastado[k] = (gastado[k] || 0) + g.monto;
  });

  return {
    mes: mes,
    base: P.base,
    ajustes: ajustes,
    efectivo: Object.assign({}, P.base, ajustes),
    gastado: gastado,
    ingresoReal: leerIngresos_().reduce(function (s, x) { return x.mes === mes && x.tipo === 'Ingreso' ? s + x.monto : s; }, 0),
    ahorroReal: leerIngresos_().reduce(function (s, x) { return x.mes === mes && x.tipo === 'Ahorro' ? s + x.monto : s; }, 0),
    variables: CATEGORIAS.filter(function (c) { return FIJAS.indexOf(c) === -1; }),
    fijas: FIJAS
  };
}

/** { mes: 'base' | 'yyyy-MM', valores: { categoria: monto } } — reemplaza lo guardado para ese mes. */
function guardarPresupuesto_(d) {
  const mes = String(d.mes || '');
  if (mes !== 'base' && !/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido');
  const valores = d.valores || {};
  return conLock_(function () {
    const sh = hojaPresupuesto_();
    const n = sh.getLastRow();
    if (n >= 2) {
      const tz = Session.getScriptTimeZone();
      const meses = sh.getRange(2, 1, n - 1, 1).getValues();
      for (let i = meses.length - 1; i >= 0; i--) {
        const m = meses[i][0] instanceof Date ? Utilities.formatDate(meses[i][0], tz, 'yyyy-MM') : String(meses[i][0]).trim();
        if (m === mes) sh.deleteRow(i + 2);
      }
    }
    const filas = Object.keys(valores).map(function (c) {
      return [mes, c, Math.max(0, Math.round(Number(valores[c]) || 0))];
    });
    if (filas.length) {
      // Si Sheets convierte "2026-10" en fecha no importa: leerPresupuesto_ la vuelve a "yyyy-MM".
      // (No se fuerza formato de texto: falla si la pestaña está convertida en tabla con columnas tipadas.)
      sh.getRange(sh.getLastRow() + 1, 1, filas.length, 3).setValues(filas);
    }
    return { ok: true };
  });
}

/* ---------- Resumen del mes (pantalla Inicio) ---------- */

/** mes = 'yyyy-MM' (opcional; por defecto, el mes actual). */
function resumenMes_(mes) {
  const tz = Session.getScriptTimeZone();
  if (!/^\d{4}-\d{2}$/.test(mes || '')) mes = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  let total = 0, cantidad = 0;
  const porCat = {};
  const movs = [];

  gastosEfectivos_().forEach(function (g) {
    if (g.mes !== mes) return;
    const clave = g.categoria || 'Sin categoría';
    total += g.monto;
    cantidad++;
    if (g.monto) porCat[clave] = (porCat[clave] || 0) + g.monto;
    movs.push(g);
  });

  movs.sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || b.reg - a.reg; });

  // Para el detalle y la edición: cuántas cuotas tiene cada compra y con quién se dividió.
  const ult = movs.slice(0, 8);
  const ing = leerIngresos_();
  let ingresos = 0, ahorro = 0;
  ing.forEach(function (x) {
    if (x.mes !== mes) return;
    if (x.tipo === 'Ingreso') ingresos += x.monto; else ahorro += x.monto;
  });
  // En "Últimos movimientos" los ingresos van por la fecha en que llegaron.
  const ingMovs = ing.filter(function (x) { return x.fecha.slice(0, 7) === mes; });
  const sh = hojaGastos_();
  const nf = sh.getLastRow();
  const ids = nf < 2 ? [] : sh.getRange(2, COL.ID, nf - 1, 1).getValues().map(function (r) { return String(r[0]); });
  const divPorGasto = {};
  leerDeudas_().forEach(function (x) {
    if (x.idGasto && x.tipo === 'Me debe') {
      (divPorGasto[x.idGasto] = divPorGasto[x.idGasto] || []).push({ persona: x.persona, monto: x.monto, estado: x.estado });
    }
  });

  return {
    mes: mes,
    total: total,
    cantidad: cantidad,
    categorias: Object.keys(porCat)
      .map(function (k) { return { categoria: k, monto: porCat[k] }; })
      .sort(function (a, b) { return b.monto - a.monto; }),
    ingresos: ingresos,
    ahorro: ahorro,
    ultimos: ult.map(function (m) {
      const g = grupoCuotas_(ids, m.id);
      const k = (m.id.match(/-c(\d+)$/) || [])[1];
      return {
        tipo: 'Gasto', reg: m.reg, mes: m.mes,
        id: m.id, fecha: m.fecha, descripcion: m.descripcion, monto: m.monto, bruto: m.bruto,
        medio: m.medio, categoria: m.categoria, origen: m.origen,
        cuotas: g.length > 1 ? g.length : 0, cuota: g.length > 1 ? Number(k || 1) : 0,
        division: divPorGasto[m.base] || []
      };
    }).concat(ingMovs.map(function (x) {
      return { tipo: x.tipo, reg: x.reg, id: x.id, fecha: x.fecha, descripcion: x.descripcion, monto: x.monto,
               bruto: x.monto, categoria: x.categoria, mes: x.mes, origen: 'Manual' };
    }))
      .sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || b.reg - a.reg; })
      .slice(0, 8)
      .map(function (m) { delete m.reg; return m; })
  };
}

/* ---------- Tendencias (gráficos) ---------- */

/**
 * Últimos N meses (por mes de presupuesto, igual que la pantalla Presupuesto):
 * total gastado, por categoría y presupuesto de gastos de cada mes. Más el gasto variable
 * acumulado día a día del mes actual y del anterior, para la línea de ritmo.
 */
function tendencias_(n) {
  n = Math.min(Math.max(Number(n) || 12, 2), 24);
  const tz = Session.getScriptTimeZone();
  const hoy = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const actual = hoy.slice(0, 7);
  const mesMenos = function (m, k) { const p = m.split('-').map(Number); const d = new Date(p[0], p[1] - 1 - k, 1, 12);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const lista = [];
  for (let k = n - 1; k >= 0; k--) lista.push(mesMenos(actual, k));
  const anterior = mesMenos(actual, 1);

  const P = leerPresupuesto_();
  const meses = {};
  lista.forEach(function (m) {
    const ef = Object.assign({}, P.base, P.meses[m] || {});
    let pres = 0, presVar = 0;
    CATEGORIAS.forEach(function (c) { const v = Number(ef[c]) || 0; pres += v; if (FIJAS.indexOf(c) === -1) presVar += v; });
    meses[m] = { mes: m, total: 0, porCat: {}, presupuesto: pres, presVar: presVar };
  });

  const diaAct = {}, diaAnt = {};
  gastosEfectivos_().forEach(function (g) {
    const M = meses[g.mes];
    if (!M || !g.monto) return;
    const cat = g.categoria || 'Sin categoría';
    M.total += g.monto;
    M.porCat[cat] = (M.porCat[cat] || 0) + g.monto;
    if (FIJAS.indexOf(cat) !== -1) return;
    const dia = Number(g.fecha.slice(8, 10));
    if (g.mes === actual && g.fecha.slice(0, 7) === actual) diaAct[dia] = (diaAct[dia] || 0) + g.monto;
    if (g.mes === anterior && g.fecha.slice(0, 7) === anterior) diaAnt[dia] = (diaAnt[dia] || 0) + g.monto;
  });

  const acumular = function (porDia, hasta) {
    const out = []; let s = 0;
    for (let d = 1; d <= hasta; d++) { s += porDia[d] || 0; out.push(s); }
    return out;
  };
  const diasMes = function (m) { const p = m.split('-').map(Number); return new Date(p[0], p[1], 0).getDate(); };

  return {
    hoy: hoy, actual: actual, fijas: FIJAS,
    meses: lista.map(function (m) { return meses[m]; }),
    ritmo: {
      dia: Number(hoy.slice(8, 10)), diasMes: diasMes(actual), diasMesAnt: diasMes(anterior),
      actual: acumular(diaAct, Number(hoy.slice(8, 10))),
      anterior: acumular(diaAnt, diasMes(anterior)),
      presVar: meses[actual].presVar
    }
  };
}

/* ---------- Todos los movimientos (pantalla de búsqueda) ---------- */

/** Todos los gastos (sin traspasos internos, préstamos ni descartados), ingresos y ahorros, del más nuevo al más viejo. */
function listarMovimientos_() {
  const sh = hojaGastos_();
  const nf = sh.getLastRow();
  const ids = nf < 2 ? [] : sh.getRange(2, COL.ID, nf - 1, 1).getValues().map(function (r) { return String(r[0]); });
  const divPorGasto = {};
  leerDeudas_().forEach(function (x) {
    if (x.idGasto && x.tipo === 'Me debe') {
      (divPorGasto[x.idGasto] = divPorGasto[x.idGasto] || []).push({ persona: x.persona, monto: x.monto, estado: x.estado });
    }
  });
  // cuántas cuotas tiene cada compra, sin recorrer la lista por cada fila
  const nCuotas = {};
  ids.forEach(function (x) { const b = x.replace(/-c\d+$/, ''); if (b) nCuotas[b] = (nCuotas[b] || 0) + 1; });

  const gastos = gastosEfectivos_().map(function (m) {
    const n = nCuotas[m.base] || 0;
    const k = (m.id.match(/-c(\d+)$/) || [])[1];
    return {
      tipo: 'Gasto', id: m.id, fecha: m.fecha, mes: m.mes, descripcion: m.descripcion, monto: m.monto, bruto: m.bruto,
      medio: m.medio, categoria: m.categoria, origen: m.origen, reg: m.reg,
      cuotas: n > 1 ? n : 0, cuota: n > 1 ? Number(k || 1) : 0, division: divPorGasto[m.base] || []
    };
  });
  const ingresos = leerIngresos_().map(function (x) {
    return { tipo: x.tipo, id: x.id, fecha: x.fecha, mes: x.mes, descripcion: x.descripcion, monto: x.monto,
             bruto: x.monto, categoria: x.categoria, origen: 'Manual', reg: x.reg };
  });
  return gastos.concat(ingresos)
    .sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || b.reg - a.reg; })
    .map(function (m) { delete m.reg; return m; });
}

/* ---------- Ingresos y ahorros ---------- */

const ICOL = { FECHA: 1, DESC: 2, MONTO: 3, TIPO: 4, CAT: 5, MES: 6, REG: 7, ID: 8 };

function hojaIngresos_() {
  const ss = libro_();
  let sh = ss.getSheetByName(SHEET_ING);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ING);
    sh.appendRow(['Fecha', 'Descripción', 'Monto', 'Tipo', 'Categoría', 'Mes', 'Registrado', 'ID']);
    sh.setFrozenRows(1);
    sh.getRange('F:F').setNumberFormat('@'); // "2026-11" como texto, no como fecha
  }
  return sh;
}

/** Mes de presupuesto por defecto: el sueldo recibido desde el día 20 cuenta para el mes siguiente. */
/** Mes de presupuesto automático de un gasto: los fijos pagados desde el día de corte van al mes siguiente. */
function mesGasto_(fechaIso, categoria) {
  if (!fechaIso) return '';
  const p = fechaIso.split('-').map(Number);
  const corte = CORTE_FIJOS[categoria] || DIA_CORTE;
  if (FIJAS.indexOf(categoria) !== -1 && p[2] >= corte) {
    const d = new Date(p[0], p[1], 1, 12);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  return fechaIso.slice(0, 7);
}

/** Celda de mes → "yyyy-MM" (acepta texto o la fecha en que Sheets lo convierte). */
function mesCelda_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM');
  const t = String(v || '').trim().replace(/^'/, '');
  return /^\d{4}-\d{2}$/.test(t) ? t : '';
}

function mesPorDefecto_(fechaIso, tipo, categoria) {
  const p = fechaIso.split('-').map(Number);
  if (tipo === 'Ingreso' && categoria === 'Sueldo' && p[2] >= DIA_CORTE) {
    const d = new Date(p[0], p[1], 1, 12); // mes siguiente
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  return fechaIso.slice(0, 7);
}

/** { id, tipo:'Ingreso'|'Ahorro', monto, descripcion, categoria, fecha, mes (opcional) } */
function agregarIngreso_(d) {
  const monto = Number(String(d.monto).replace(/\D/g, ''));
  if (!monto || monto <= 0) throw new Error('Monto inválido');
  return conLock_(function () { return escribirIngreso_(d, monto); });
}

/** Escribe la fila en Ingresos. No toma el lock (lo hace quien la llama). */
function escribirIngreso_(d, monto) {
  monto = monto || Number(String(d.monto).replace(/\D/g, ''));
  if (!monto || monto <= 0) throw new Error('Monto inválido');
  const sh = hojaIngresos_();
    if (d.id && buscarFila_(sh, d.id, ICOL.ID)) return 'dup';
    const tz = Session.getScriptTimeZone();
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const cat = String(d.categoria || '');
    const mes = /^\d{4}-\d{2}$/.test(d.mes || '') ? d.mes : mesPorDefecto_(fecha, d.tipo, cat);
    const f = sh.getLastRow() + 1;
    sh.getRange(f, 1, 1, 8).setValues([[
      new Date(fecha + 'T12:00:00'), String(d.descripcion || ''), monto, d.tipo, cat, mes,
      new Date(), String(d.id || ('i-' + Utilities.getUuid()))
    ]]);
    return 'ok';
}

function leerIngresos_() {
  const sh = hojaIngresos_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, n - 1, 8).getValues()
    .map(function (r) {
      const fecha = isoFecha_(r[ICOL.FECHA - 1], tz);
      const tipo = String(r[ICOL.TIPO - 1]).trim() === 'Ahorro' ? 'Ahorro' : 'Ingreso';
      const cat = String(r[ICOL.CAT - 1]).trim();
      let mes = r[ICOL.MES - 1] instanceof Date ? Utilities.formatDate(r[ICOL.MES - 1], tz, 'yyyy-MM') : String(r[ICOL.MES - 1]).trim();
      if (!/^\d{4}-\d{2}$/.test(mes) && fecha) mes = mesPorDefecto_(fecha, tipo, cat);
      const reg = r[ICOL.REG - 1];
      return {
        fecha: fecha, descripcion: String(r[ICOL.DESC - 1]), monto: Math.round(Number(r[ICOL.MONTO - 1]) || 0),
        tipo: tipo, categoria: cat, mes: mes, reg: reg instanceof Date ? reg.getTime() : 0, id: String(r[ICOL.ID - 1])
      };
    })
    .filter(function (x) { return x.monto && x.fecha; });
}

/** Lo llama editarGasto_ (ya con el lock tomado) cuando el ID es de un ingreso o ahorro. */
function editarIngreso_(d) {
  const sh = hojaIngresos_();
  const fila = buscarFila_(sh, d.id, ICOL.ID);
  const r = sh.getRange(fila, 1, 1, 8).getValues()[0];
  const tz = Session.getScriptTimeZone();
  const monto = d.monto === undefined ? Number(r[ICOL.MONTO - 1]) : Number(String(d.monto).replace(/\D/g, ''));
  if (!monto || monto <= 0) throw new Error('Monto inválido');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : isoFecha_(r[ICOL.FECHA - 1], tz);
  const desc = String(d.descripcion === undefined ? r[ICOL.DESC - 1] : d.descripcion).trim();
  const cat = String(d.categoria === undefined ? r[ICOL.CAT - 1] : d.categoria).trim();
  const tipo = String(r[ICOL.TIPO - 1]).trim() === 'Ahorro' ? 'Ahorro' : 'Ingreso';
  const mes = /^\d{4}-\d{2}$/.test(d.mes || '') ? d.mes : mesPorDefecto_(fecha, tipo, cat);
  sh.getRange(fila, 1, 1, 6).setValues([[new Date(fecha + 'T12:00:00'), desc, monto, tipo, cat, mes]]);
  return { ok: true };
}

/* ---------- Editar y eliminar gastos ---------- */

/** IDs de todas las filas de la misma compra (cuotas incluidas): <base>, <base>-c2, <base>-c3… */
function grupoCuotas_(ids, id) {
  const base = String(id || '').replace(/-c\d+$/, '');
  if (!base) return [];
  const vistos = {};
  return ids.filter(function (x) {
    if (vistos[x]) return false;
    const ok = x === base || (x.indexOf(base + '-c') === 0 && /^-c\d+$/.test(x.slice(base.length)));
    if (ok) vistos[x] = 1;
    return ok;
  });
}

const SUFIJO_CUOTA = /\s*\(\d+\/\d+\)$/;

/**
 * { id, descripcion, monto, fecha, medio, categoria, mes (opcional: yyyy-MM del presupuesto),
 *   division (opcional: [{persona, monto}]) }
 * - Compra en cuotas: descripción, medio y categoría se aplican a todas las cuotas; monto y fecha no se cambian.
 * - Gasto dividido con otras personas: el monto no se cambia (descuadraría las deudas).
 */
function editarGasto_(d) {
  if (!d.id) throw new Error('Falta el ID');
  return conLock_(function () {
    const sh = hojaGastos_();
    const fila = buscarFila_(sh, d.id);
    if (!fila && buscarFila_(hojaIngresos_(), d.id, ICOL.ID)) return editarIngreso_(d);
    if (!fila) throw new Error('No encontré ese gasto (¿lo borraste del Sheet?)');

    const n = sh.getLastRow();
    const ids = sh.getRange(2, COL.ID, n - 1, 1).getValues().map(function (r) { return String(r[0]); });
    const grupo = grupoCuotas_(ids, d.id);
    const base = String(d.id).replace(/-c\d+$/, '');
    const deudas = leerDeudas_().filter(function (x) { return x.idGasto === base; });

    const r = sh.getRange(fila, 1, 1, 8).getValues()[0];
    const tz = Session.getScriptTimeZone();
    const montoAct = Number(r[COL.MONTO - 1]) || 0;
    const fechaAct = isoFecha_(r[COL.FECHA - 1], tz);

    const monto = d.monto === undefined ? montoAct : Number(String(d.monto).replace(/\D/g, ''));
    if (!monto || monto <= 0) throw new Error('Monto inválido');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : fechaAct;

    if (monto !== montoAct) {
      if (grupo.length > 1) throw new Error('Es una compra en cuotas: el monto no se puede editar.');
      if (deudas.length) throw new Error('El gasto está dividido con otras personas: el monto no se puede editar.');
    }
    if (fecha !== fechaAct && grupo.length > 1) throw new Error('Es una compra en cuotas: la fecha no se puede editar.');

    const desc = String(d.descripcion === undefined ? r[COL.DESC - 1] : d.descripcion).replace(SUFIJO_CUOTA, '').trim();
    if (!desc) throw new Error('Falta la descripción');
    const medio = String(d.medio === undefined ? r[COL.MEDIO - 1] : d.medio);
    const cat = String(d.categoria === undefined ? r[COL.CAT - 1] : d.categoria).trim();

    // Fila editada
    sh.getRange(fila, COL.FECHA, 1, 5).setValues([[
      new Date(fecha + 'T12:00:00'),
      grupo.length > 1 ? desc + ((String(r[COL.DESC - 1]).match(SUFIJO_CUOTA) || [''])[0]) : desc,
      monto, medio, cat
    ]]);

    // Resto de las cuotas: misma descripción (con su propio "k/N"), medio y categoría
    grupo.forEach(function (gid) {
      if (gid === String(d.id)) return;
      const f = buscarFila_(sh, gid);
      if (!f) return;
      const dAct = String(sh.getRange(f, COL.DESC).getValue());
      sh.getRange(f, COL.DESC).setValue(desc + ((dAct.match(SUFIJO_CUOTA) || [''])[0]));
      sh.getRange(f, COL.MEDIO, 1, 2).setValues([[medio, cat]]);
    });

    // Mes del presupuesto: se guarda solo si difiere del automático (así un cambio de categoría lo recalcula)
    if (d.mes !== undefined) {
      const auto = mesGasto_(fecha, cat);
      const m = /^\d{4}-\d{2}$/.test(d.mes || '') && d.mes !== auto ? d.mes : '';
      if (!String(sh.getRange(1, COL.MES).getValue())) sh.getRange(1, COL.MES).setValue('Mes');
      sh.getRange(fila, COL.MES).setValue(m ? "'" + m : '');
    }

    // El detalle de las deudas ligadas sigue a la descripción
    if (deudas.length) {
      const shD = hojaDeudas_();
      deudas.forEach(function (x) { shD.getRange(x.fila, DCOL.DETALLE).setValue(desc); });
    }

    // Dividir un gasto que ya estaba guardado (ej. lo categorizó una regla antes de que alcanzaras a dividirlo)
    const div = divisiones_(d.division);
    if (div.length) {
      if (deudas.length) throw new Error('Este gasto ya está dividido. Cambia la división desde Deudas.');
      const totalCompra = grupo.reduce(function (a, gid) {
        const f = buscarFila_(sh, gid); return a + (f ? Number(sh.getRange(f, COL.MONTO).getValue()) || 0 : 0);
      }, 0) || monto;
      const deben = div.reduce(function (a, x) { return a + Number(x.monto); }, 0);
      if (deben > totalCompra) throw new Error('Lo que te deben no puede superar el gasto.');
      const fBase = buscarFila_(sh, base) || fila;
      crearDeudasDeGasto_(base, div, desc, isoFecha_(sh.getRange(fBase, COL.FECHA).getValue(), tz));
    }
    return { ok: true, dividido: div.length };
  });
}

/** { id } — borra el gasto y todas sus cuotas. No se permite si alguien todavía te debe parte de él. */
function eliminarGasto_(d) {
  if (!d.id) throw new Error('Falta el ID');
  return conLock_(function () {
    const shI = hojaIngresos_();
    const fi = buscarFila_(shI, d.id, ICOL.ID);
    if (fi) { shI.deleteRow(fi); return { ok: true, borradas: 1 }; }
    const base = String(d.id).replace(/-c\d+$/, '');
    const pend = leerDeudas_().filter(function (x) { return x.idGasto === base && x.estado === 'Pendiente'; });
    if (pend.length) {
      throw new Error('Este gasto está dividido y ' + pend.map(function (x) { return x.persona; }).join(', ') +
        ' todavía te debe. Primero márcalo pagado o perdonado en Deudas.');
    }
    const sh = hojaGastos_();
    const n = sh.getLastRow();
    if (n < 2) return { ok: true, borradas: 0 };
    const ids = sh.getRange(2, COL.ID, n - 1, 1).getValues().map(function (r) { return String(r[0]); });
    const grupo = grupoCuotas_(ids, d.id);
    let borradas = 0;
    for (let i = ids.length - 1; i >= 0; i--) {   // de abajo hacia arriba para no correr las filas
      if (grupo.indexOf(ids[i]) !== -1) { sh.deleteRow(i + 2); borradas++; }
    }
    return { ok: true, borradas: borradas };
  });
}

function limpiarComercio_(c) {
  return c.trim().replace(/^(MERPAGO|MERCADOPAGO|MP|DLO|DL|PAYU|FLOW|KHIPU|SUMUP)\s*\*\s*/i, '');
}

/* ---------- Transferencias ---------- */

const ORIGEN_TRANSF = 'BChile transf';
const PREF_AHORRO   = '_Ahorro:';
const TCOL = { FECHA: 1, REMITENTE: 2, MONTO: 3, BANCO: 4, ESTADO: 5, ID: 6, REG: 7, ASUNTO: 8 };
const MESES_ES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
                   septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

function hojaTransf_() {
  const ss = libro_();
  let sh = ss.getSheetByName(SHEET_TRANSF);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TRANSF);
    sh.appendRow(['Fecha', 'Remitente', 'Monto', 'Banco', 'Estado', 'ID', 'Registrado', 'Asunto']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function agregarTransfRecibida_(d) {
  const monto = Number(String(d.monto).replace(/\D/g, ''));
  if (!monto) return 'invalido';
  return conLock_(function () {
    const sh = hojaTransf_();
    if (buscarFila_(sh, d.id, TCOL.ID)) return 'dup';
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? new Date(d.fecha + 'T12:00:00') : new Date();
    if (!String(sh.getRange(1, TCOL.ASUNTO).getValue())) sh.getRange(1, TCOL.ASUNTO).setValue('Asunto'); // hojas creadas antes
    sh.appendRow([fecha, d.remitente, monto, d.banco, String(d.estado || ''), d.id, new Date(), String(d.asunto || '')]);
    return 'ok';
  });
}

function leerTransfRecibidas_() {
  const sh = hojaTransf_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, n - 1, 8).getValues().map(function (r, i) {
    return {
      fila: i + 2, fecha: isoFecha_(r[TCOL.FECHA - 1], tz), remitente: String(r[TCOL.REMITENTE - 1]).trim(),
      monto: Math.round(Number(r[TCOL.MONTO - 1]) || 0), banco: String(r[TCOL.BANCO - 1]),
      estado: String(r[TCOL.ESTADO - 1]).trim(), id: String(r[TCOL.ID - 1]), asunto: String(r[TCOL.ASUNTO - 1] || '').trim()
    };
  }).filter(function (x) { return x.id && x.monto; });
}

/* ---------- Traspasos entre tus cuentas ---------- */

const CAT_INTERNA = '_Interna';   // empieza con "_": no cuenta como gasto

/** ¿El nombre es el tuyo? Excepto si lo marcaste como destino de ahorro (ej. tu cuenta en una corredora). */
function esInterna_(nombre) {
  const n = sinTildes_(nombre);
  if (!n) return false;
  const a = leerAlias_()[n];
  if (a && a.indexOf(PREF_AHORRO) === 0) return false;
  if (!TITULAR.length) return false;
  const palabras = n.split(' ');
  return TITULAR.every(function (w) { return palabras.indexOf(sinTildes_(w)) !== -1; });
}

/** "Banco Del Estado De Chile" → "BancoEstado", etc. (solo para que la descripción sea corta) */
function nombreBanco_(b) {
  const t = sinTildes_(b);
  if (!t) return '';
  if (/estado/.test(t)) return 'BancoEstado';
  if (/santander/.test(t)) return 'Santander';
  if (/chile|edwards/.test(t)) return 'Banco de Chile';
  if (/itau/.test(t)) return 'Itaú';
  if (/bci|credito e inversiones/.test(t)) return 'BCI';
  return String(b).trim();
}

/** Si el correo había quedado como transferencia recibida (error de versiones anteriores), la saca de Pendientes. */
function corregirComoRecibida_(id) {
  const sh = hojaTransf_();
  const f = buscarFila_(sh, id, TCOL.ID);
  if (f && !String(sh.getRange(f, TCOL.ESTADO).getValue()).trim()) sh.getRange(f, TCOL.ESTADO).setValue('Corregida: era enviada');
}

/** Ejecútala UNA vez: saca de Pendientes los traspasos entre tus cuentas que ya habían llegado. */
function marcarInternas() {
  let n = 0;
  conLock_(function () {
    const sh = hojaGastos_();
    const f = sh.getLastRow();
    if (f >= 2) {
      sh.getRange(2, 1, f - 1, 8).getValues().forEach(function (r, i) {
        if (String(r[COL.ORIGEN - 1]) !== ORIGEN_TRANSF || String(r[COL.CAT - 1]).trim()) return;
        if (esInterna_(personaDeDescripcion_(String(r[COL.DESC - 1])))) { sh.getRange(i + 2, COL.CAT).setValue(CAT_INTERNA); n++; }
      });
    }
    const shT = hojaTransf_();
    leerTransfRecibidas_().forEach(function (x) {
      if (!x.estado && esInterna_(x.remitente)) { shT.getRange(x.fila, TCOL.ESTADO).setValue('Interna'); n++; }
    });
  });
  Logger.log('Traspasos internos marcados: ' + n);
}

/* ---------- Personas: alias y sugerencias ---------- */

function sinTildes_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-zñ0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** "JUAN ANDRES SOTO DIAZ" → "Juan Andres Soto Diaz" */
function nombrePropio_(s) {
  s = String(s || '').trim();
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
}

function personaDeDescripcion_(desc) {
  const m = String(desc).match(/^Transf\. a (.+?)(?: · |$)/);
  return m ? m[1].trim() : '';
}

function hojaAlias_() {
  const ss = libro_();
  let sh = ss.getSheetByName(SHEET_ALIAS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ALIAS);
    sh.appendRow(['Nombre en el banco', 'Persona']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function leerAlias_() {
  const sh = hojaAlias_();
  const n = sh.getLastRow();
  const out = {};
  if (n < 2) return out;
  sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
    if (String(r[0]).trim() && String(r[1]).trim()) out[sinTildes_(r[0])] = String(r[1]).trim();
  });
  return out;
}

function guardarAlias_(nombreBanco, persona) {
  const k = sinTildes_(nombreBanco);
  if (!k || !persona || k === sinTildes_(persona)) return;
  const sh = hojaAlias_();
  const n = sh.getLastRow();
  if (n >= 2) {
    const vals = sh.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (sinTildes_(vals[i][0]) === k) { sh.getRange(i + 2, 2).setValue(persona); return; }
    }
  }
  sh.appendRow([String(nombreBanco).trim(), persona]);
}

/** Todas las personas de Deudas con su saldo pendiente (+ = te debe, − = le debes). */
function personasConSaldo_() {
  const filas = leerDeudas_();
  const nombres = {};
  filas.forEach(function (x) { nombres[x.persona.toLowerCase()] = nombres[x.persona.toLowerCase()] || x.persona; });
  return Object.keys(nombres).map(function (k) {
    return { nombre: nombres[k], saldo: saldoPersona_(filas, nombres[k]) };
  }).sort(function (a, b) { return Math.abs(b.saldo) - Math.abs(a.saldo) || a.nombre.localeCompare(b.nombre); });
}

/**
 * Persona de Deudas que corresponde al nombre que trae el banco.
 * 1) alias guardado; 2) todas las palabras del nombre en Deudas aparecen en el del banco
 * ("Sofía A" calza con "Ana Pérez"). Prefiere a quien tiene saldo en el sentido esperado
 * (signo 1 = te debe, -1 = le debes).
 */
function sugerirPersona_(nombreBanco, personas, alias, signo) {
  const k = sinTildes_(nombreBanco);
  if (!k) return '';
  if (alias[k] && alias[k].charAt(0) !== '_') return alias[k];
  const toks = k.split(' ');
  let mejor = '', puntaje = 0;
  personas.forEach(function (p) {
    const pt = sinTildes_(p.nombre).split(' ').filter(Boolean);
    if (!pt.length) return;
    const calza = pt.every(function (w) {
      return toks.some(function (t) { return w.length === 1 ? t.charAt(0) === w : t === w; });
    });
    if (!calza) return;
    const pts = pt.length * 10 + (p.saldo * signo > 0 ? 100 : 0);
    if (pts > puntaje) { puntaje = pts; mejor = p.nombre; }
  });
  return mejor;
}

/* ---------- Resolver transferencias desde Pendientes ---------- */

/**
 * { id, destino, persona, categoria, descripcion, items (IDs de deuda en el orden a pagar; opcional) }
 * Recibida: destino 'deuda' (pago de lo que te deben) | 'ingreso'.
 * Enviada:  destino 'prestamo' (le prestaste: crea "Me debe") | 'pagodeuda' (pagas lo que debías)
 *           | 'ahorro' (a tu cuenta de inversión: crea la fila de Ahorro con { categoria }).
 *           Para enviarla como gasto normal se usa 'categorizar'.
 */
function resolverTransf_(d) {
  if (!d.id || !d.destino) throw new Error('Faltan datos');
  return conLock_(function () {
    const tz = Session.getScriptTimeZone();
    const persona = String(d.persona || '').trim();

    const shT = hojaTransf_();
    const ft = buscarFila_(shT, d.id, TCOL.ID);
    if (ft) {
      const r = shT.getRange(ft, 1, 1, 7).getValues()[0];
      if (String(r[TCOL.ESTADO - 1]).trim()) return { ok: true, yaResuelta: true };
      const monto = Math.round(Number(r[TCOL.MONTO - 1]) || 0);
      const fecha = isoFecha_(r[TCOL.FECHA - 1], tz);
      const remitente = String(r[TCOL.REMITENTE - 1]);

      if (d.destino === 'deuda') {
        if (!persona) throw new Error('Elige la persona');
        const res = registrarPagoDeuda_(persona, monto, fecha, 'p-' + d.id, true, d.items);
        guardarAlias_(remitente, persona);
        shT.getRange(ft, TCOL.ESTADO).setValue('Deuda: ' + persona);
        return Object.assign({ ok: true }, res);
      }
      if (d.destino === 'ingreso') {
        escribirIngreso_({
          id: 'i-' + d.id, tipo: 'Ingreso', monto: monto, fecha: fecha,
          categoria: String(d.categoria || 'Otros ingresos'),
          descripcion: String(d.descripcion || ('Transferencia de ' + nombrePropio_(remitente))).trim()
        }, monto);
        shT.getRange(ft, TCOL.ESTADO).setValue('Ingreso');
        return { ok: true };
      }
      throw new Error('Destino inválido');
    }

    const sh = hojaGastos_();
    const fila = buscarFila_(sh, d.id);
    if (!fila) throw new Error('No encontré esa transferencia (¿la borraste del Sheet?)');
    const r = sh.getRange(fila, 1, 1, 8).getValues()[0];
    const monto = Math.round(Number(r[COL.MONTO - 1]) || 0);
    const fecha = isoFecha_(r[COL.FECHA - 1], tz);
    const desc = String(d.descripcion || r[COL.DESC - 1]).trim();
    const nombreBanco = personaDeDescripcion_(String(r[COL.DESC - 1]));

    if (d.destino === 'ahorro') {
      const cat = String(d.categoria || CAT_AHORRO[CAT_AHORRO.length - 1]);
      escribirIngreso_({ id: 'i-' + d.id, tipo: 'Ahorro', monto: monto, fecha: fecha, categoria: cat,
                         descripcion: desc }, monto);
      sh.getRange(fila, COL.CAT).setValue('_Ahorro');
      sh.getRange(fila, COL.DESC).setValue(desc);
      guardarAlias_(nombreBanco, PREF_AHORRO + ' ' + cat);
      return { ok: true };
    }

    if (!persona) throw new Error('Elige la persona');

    if (d.destino === 'prestamo') {
      agregarDeuda_({ id: 'd-' + d.id, tipo: 'Me debe', persona: persona, monto: monto, fecha: fecha,
                      detalle: d.detalle || 'Préstamo por transferencia' });
      sh.getRange(fila, COL.CAT).setValue('_Préstamo');
    } else if (d.destino === 'pagodeuda') {
      var res = registrarPagoDeuda_(persona, monto, fecha, 'p-' + d.id, false, d.items);
      sh.getRange(fila, COL.CAT).setValue('_Pago deuda');
    } else {
      throw new Error('Destino inválido');
    }
    sh.getRange(fila, COL.DESC).setValue(desc);
    guardarAlias_(nombreBanco, persona);
    return Object.assign({ ok: true }, res || {});
  });
}

/**
 * Registra un pago de deuda por transferencia, repartido por ítem. No toma el lock.
 * recibido = true: la persona te paga (necesita saldo a tu favor). Lo que exceda el saldo
 *   queda como Ingreso "Otros ingresos" (mismo criterio que Saldar en la app).
 * recibido = false: tú le pagas (necesita saldo en contra). Si pagas de más, el exceso queda como "Me debe".
 *
 * Reparto: el pago (más lo que ya estaba a cuenta: abonos anteriores o deudas en sentido contrario)
 * cubre los ítems en el orden `orden` (IDs elegidos en la app) y después de más antiguo a más nuevo.
 * Ítem cubierto completo → Pagado. Ítem cubierto a medias → Pagado + ítem nuevo "<detalle> (resto)"
 * con la fecha original. Así siempre se ve qué falta de qué.
 */
function registrarPagoDeuda_(persona, monto, fecha, id, recibido, orden) {
  const filas = leerDeudas_();
  const saldo = saldoPersona_(filas, persona);
  if (recibido ? saldo <= 0 : saldo >= 0) {
    throw new Error(recibido ? persona + ' no tiene deuda pendiente contigo. Regístralo como ingreso.'
                             : 'No tienes deuda pendiente con ' + persona + '. Regístralo como gasto o préstamo.');
  }
  const aplicado = Math.min(monto, Math.abs(saldo));
  const signo = recibido ? 1 : -1;
  const pend = filas.filter(function (x) { return x.estado === 'Pendiente' && mismaPersona_(x.persona, persona); });
  const items = ordenarItems_(pend.filter(function (x) { return TIPOS_DEUDA[x.tipo] === signo; }), orden);
  const contra = pend.filter(function (x) { return TIPOS_DEUDA[x.tipo] !== signo; });

  const sh = hojaDeudas_();
  let disponible = aplicado + contra.reduce(function (a, x) { return a + x.monto; }, 0);
  const reparto = [];
  items.forEach(function (x, k) {
    if (disponible <= 0) return;
    sh.getRange(x.fila, DCOL.ESTADO).setValue('Pagado');
    if (disponible >= x.monto) {
      disponible -= x.monto;
      reparto.push({ detalle: x.detalle || x.tipo, pagado: x.monto, queda: 0 });
    } else {
      const queda = x.monto - disponible;
      agregarDeuda_({ id: id + '-r' + (k + 1), tipo: x.tipo, persona: x.persona, monto: queda, fecha: x.fecha,
                      detalle: String(x.detalle || x.tipo).replace(/ \(resto\)$/, '') + ' (resto)' });
      reparto.push({ detalle: x.detalle || x.tipo, pagado: disponible, queda: queda });
      disponible = 0;
    }
  });
  contra.forEach(function (x) { sh.getRange(x.fila, DCOL.ESTADO).setValue('Pagado'); });
  agregarDeuda_({ id: id, persona: persona, monto: aplicado, fecha: fecha, estado: 'Pagado',
                  tipo: recibido ? 'Me pagó' : 'Le pagué', detalle: 'Transferencia' });
  const quedo = saldoPersona_(leerDeudas_(), persona);

  const extra = monto - aplicado;
  if (extra > 0) {
    if (recibido) {
      escribirIngreso_({ id: 'i-' + id, tipo: 'Ingreso', monto: extra, fecha: fecha, categoria: 'Otros ingresos',
                         descripcion: 'Extra pago deuda · ' + persona }, extra);
    } else {
      agregarDeuda_({ id: id + '-x', persona: persona, monto: extra, fecha: fecha, tipo: 'Me debe',
                      detalle: 'Pagaste de más por transferencia' });
    }
  }
  return { saldo: quedo, extra: extra, reparto: reparto };
}

/** Primero los IDs de `orden` (en ese orden), después el resto de más antiguo a más nuevo. */
function ordenarItems_(items, orden) {
  const pos = {};
  [].concat(orden || []).forEach(function (oid, k) { pos[String(oid)] = k; });
  return items.slice().sort(function (a, b) {
    const pa = a.id in pos ? pos[a.id] : Infinity, pb = b.id in pos ? pos[b.id] : Infinity;
    if (pa !== pb) return pa - pb;
    return a.fecha.localeCompare(b.fecha) || a.fila - b.fila;
  });
}

/* ---------- Utilidades ---------- */

function hash_(s) {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return b.map(x => ((x + 256) % 256).toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Pruebas y preparación (ejecutar desde el editor) ---------- */
function limpiarDuplicados() {
  const sh = hojaGastos_();
  const n = sh.getLastRow();
  if (n < 2) return;
  const filas = sh.getRange(2, 1, n - 1, 8).getValues();
  const queda = {};
  filas.forEach(function (r, i) {
    const id = String(r[COL.ID - 1] || '');
    if (!id) return;
    if (!(id in queda)) { queda[id] = i; return; }
    if (!String(filas[queda[id]][COL.CAT - 1]).trim() && String(r[COL.CAT - 1]).trim()) queda[id] = i;
  });
  let borradas = 0;
  for (let i = filas.length - 1; i >= 0; i--) {
    const id = String(filas[i][COL.ID - 1] || '');
    if (id && queda[id] !== i) { sh.deleteRow(i + 2); borradas++; }
  }
  Logger.log('Duplicados borrados: ' + borradas);
}

function probarNotif() {
  const r = procesarNotif_('El 01-10-2026 14:01:28 se realizó una compra con tu Tarjeta de ' +
    'Crédito terminada en 1234 en COMERCIALIZADORA Y DIS por $ 1.600. Si desconoces ' +
    'esta operacion revisa si corresponde a una tarjeta adicional..');
  Logger.log(JSON.stringify(r)); // esperado: {"ok":true,"procesado":true,"duplicado":false}
}

function probarPresupuesto() {
  Logger.log(JSON.stringify(presupuestoMes_()));
}

function probarResumen() {
  Logger.log(JSON.stringify(resumenMes_()));
}

/* ---------- Instalación: libro, clave, menú ---------- */

function libro_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/** La clave vive en las propiedades del script (no en el código), así puedes compartir este archivo sin riesgo. */
function clave_() {
  const props = PropertiesService.getScriptProperties();
  let k = props.getProperty('api_key');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); props.setProperty('api_key', k); }
  return k;
}

function claveValida_(k) {
  const guardada = PropertiesService.getScriptProperties().getProperty('api_key');
  return !!guardada && String(k || '') === guardada;
}

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu('Gastos')
    .addItem('Configurar', 'configurar')
    .addItem('Ver clave de la app', 'verClave')
    .addItem('Cambiar clave (desconecta los celulares)', 'cambiarClave');
  if (typeof activarCorreos === 'function') {   // solo si pegaste Correos.gs
    menu.addSeparator()
      .addItem('Activar lectura de correos del banco', 'activarCorreos')
      .addItem('Desactivar lectura de correos', 'desactivarCorreos');
  }
  menu.addToUi();
}

/** Crea las pestañas que falten y la clave. Se puede ejecutar varias veces sin borrar nada. */
function configurar() {
  const ss = libro_();
  let g = ss.getSheetByName(SHEET_NAME);
  if (!g) g = ss.insertSheet(SHEET_NAME, 0);
  if (g.getLastRow() === 0) {
    g.appendRow(['Fecha', 'Descripción', 'Monto', 'Medio', 'Categoría', 'Registrado', 'ID', 'Origen', 'Mes']);
    g.setFrozenRows(1);
    g.getRange('I:I').setNumberFormat('@');
  }
  hojaDeudas_(); hojaIngresos_(); hojaTransf_(); hojaAlias_();
  // Presupuesto base en 0 (se edita desde la app) y reglas de ejemplo, solo si esas pestañas están vacías
  const pres = hojaPresupuesto_();
  if (pres.getLastRow() < 2) {
    pres.getRange('A:A').setNumberFormat('@');
    const cats = ['_Ingreso'].concat(CATEGORIAS, ['_Ahorro']);
    pres.getRange(2, 1, cats.length, 3).setValues(cats.map(function (c) { return ['base', c, 0]; }));
  }
  const reg = hojaReglas_();
  if (reg.getLastRow() < 2) {
    const ej = [['UBER', 'Transporte'], ['CABIFY', 'Transporte'], ['COPEC', 'Transporte'],
                ['JUMBO', 'Supermercado'], ['LIDER', 'Supermercado'], ['UNIMARC', 'Supermercado'],
                ['NETFLIX', 'Suscripciones'], ['SPOTIFY', 'Suscripciones'], ['CRUZ VERDE', 'Salud y cuidado personal'],
                ['RAPPI', 'Comida fuera'], ['PEDIDOSYA', 'Comida fuera']]
      .filter(function (r) { return CATEGORIAS.indexOf(r[1]) !== -1; });
    if (ej.length) reg.getRange(2, 1, ej.length, 2).setValues(ej);
  }
  clave_();
  avisar_('Listo. Ahora en Apps Script: Implementar → Nueva implementación → Aplicación web ' +
          '(Ejecutar como: Yo · Acceso: Cualquier usuario). Después usa "Gastos → Ver clave de la app".');
}

function verClave() {
  avisar_('Clave para la app:\n\n' + clave_() + '\n\nEn la app: engranaje → pega la URL de la implementación (termina en /exec) y esta clave.');
}

function cambiarClave() {
  PropertiesService.getScriptProperties().deleteProperty('api_key');
  verClave();
}

function avisar_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
