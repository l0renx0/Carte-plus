/* Carte+ — carte fedeltà offline. Tutto resta sul telefono (IndexedDB). */
'use strict';

const APP_VERSION = '1.0.0';

/* =========================================================
 * Archivio (IndexedDB)
 * ======================================================= */
const DB = (() => {
  const NAME = 'carteplus';
  const STORE = 'cards';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    all: () => tx('readonly', s => reqP(s.getAll())),
    get: id => tx('readonly', s => reqP(s.get(id))),
    put: card => tx('readwrite', s => { s.put(card); }),
    remove: id => tx('readwrite', s => { s.delete(id); }),
  };
})();

/* =========================================================
 * Utilità
 * ======================================================= */
const $ = sel => document.querySelector(sel);
const COLORS = ['#c62828', '#e65100', '#f9a825', '#2e7d32', '#00838f', '#1f4e8c', '#6a1b9a', '#ad1457', '#4e342e', '#37474f', '#000000', '#e0e0e0'];

const STORES = ['Conad', 'Coop', 'Esselunga', 'Carrefour', 'Lidl', 'Eurospin', 'Pam', 'Despar', 'Interspar', 'Eurospar',
  'Famila', 'Bennet', 'Iper', 'Il Gigante', 'Iperal', 'Unes', 'Tigros', 'Crai', 'Sigma', 'Sisa', 'Penny', 'MD', 'Todis',
  'Tuodì', 'Ali', 'Basko', 'Decò', 'Tigotà', 'Acqua & Sapone', 'Caddy\'s', 'Douglas', 'Sephora', 'Kiko', 'Feltrinelli',
  'Mondadori', 'MediaWorld', 'Unieuro', 'Euronics', 'Expert', 'Trony', 'Decathlon', 'IKEA Family', 'Leroy Merlin',
  'Brico', 'OBI', 'Bricocenter', 'OVS', 'Coin', 'Upim', 'Zara', 'H&M', 'Calzedonia', 'Intimissimi', 'Tezenis', 'Yamamay',
  'Pittarello', 'Arcaplanet', 'Maxi Zoo', 'Farmacia', 'Eni', 'Q8', 'IP', 'Esso', 'Tamoil', 'Autogrill', 'Trenitalia',
  'Italo', 'Ryanair', 'ITA Airways', 'Biblioteca', 'Palestra', 'Benzinaio', 'Bar', 'Edicola', 'Ottico'];

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
function colorFor(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % (COLORS.length - 2)];
}
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function confirmDialog(text, okLabel = 'Elimina') {
  const d = $('#confirm');
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  if (typeof d.showModal !== 'function') return Promise.resolve(window.confirm(text));
  return new Promise(resolve => {
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.returnValue = '';
    d.showModal();
  });
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} }

/* Riduce una foto per non occupare troppo spazio. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
    img.src = url;
  });
}
async function shrinkPhoto(file, max = 1000) {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/* =========================================================
 * Disegno del codice a barre
 * ======================================================= */
const ZXING_TO_FORMAT = {
  EAN_13: 'EAN13', ean_13: 'EAN13',
  EAN_8: 'EAN8', ean_8: 'EAN8',
  UPC_A: 'UPC', upc_a: 'UPC',
  UPC_E: 'UPCE', upc_e: 'UPCE',
  CODE_128: 'CODE128', code_128: 'CODE128',
  CODE_39: 'CODE39', code_39: 'CODE39',
  CODE_93: 'CODE128', code_93: 'CODE128',
  ITF: 'ITF', itf: 'ITF',
  CODABAR: 'codabar', codabar: 'codabar',
  QR_CODE: 'QR', qr_code: 'QR',
};

/* Indovina il formato più probabile dal solo numero. */
function guessFormat(code) {
  if (/^\d{13}$/.test(code) && validEan(code)) return 'EAN13';
  if (/^\d{8}$/.test(code) && validEan(code)) return 'EAN8';
  if (/^\d{12}$/.test(code) && validEan('0' + code)) return 'UPC';
  if (code.length > 60 || /^https?:\/\//i.test(code)) return 'QR';
  return 'CODE128';
}
function validEan(code) {
  const d = code.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

/* Disegna il codice dentro `box`. Ritorna il formato effettivamente usato o null. */
function renderBarcode(box, code, format, opts = {}) {
  box.innerHTML = '';
  box.classList.remove('qr');
  if (!code) return null;
  let fmt = format && format !== 'auto' ? format : guessFormat(code);

  if (fmt === 'QR') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(unescape(encodeURIComponent(code)));
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
      box.classList.add('qr');
      return 'QR';
    } catch (e) {
      return null;
    }
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  box.appendChild(svg);
  const settings = {
    format: fmt,
    width: opts.small ? 2 : 3,
    height: opts.small ? 70 : 150,
    displayValue: false,
    margin: opts.small ? 6 : 14,
    background: '#ffffff',
    lineColor: '#000000',
  };
  try {
    JsBarcode(svg, code, settings);
    return fmt;
  } catch (e) {
    // Formato non compatibile col numero: ripiega su Code 128, che accetta tutto.
    if (fmt !== 'CODE128') {
      try { JsBarcode(svg, code, { ...settings, format: 'CODE128' }); return 'CODE128'; } catch (_) {}
    }
    box.innerHTML = '';
    return null;
  }
}

/* =========================================================
 * Lettura codici (fotocamera / foto)
 * ======================================================= */
const Scanner = (() => {
  let stream = null;
  let running = false;
  let detector = null;
  let zxReader = null;
  let canvas = null;
  let onFound = null;
  let timer = null;

  const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];

  async function getDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ('BarcodeDetector' in window) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
        if (formats.length) detector = new window.BarcodeDetector({ formats });
      }
    } catch (_) { detector = false; }
    return detector;
  }

  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (loadZxing._p) return loadZxing._p;
    loadZxing._p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/zxing.min.js';
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { loadZxing._p = null; reject(new Error('Lettore non disponibile')); };
      document.head.appendChild(s);
    });
    return loadZxing._p;
  }

  async function getZxReader() {
    if (zxReader) return zxReader;
    const ZX = await loadZxing();
    const hints = new Map();
    const F = ZX.BarcodeFormat;
    hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE]);
    hints.set(ZX.DecodeHintType.TRY_HARDER, true);
    zxReader = new ZX.MultiFormatReader();
    zxReader.setHints(hints);
    return zxReader;
  }

  function zxDecodeCanvas(c) {
    const ZX = window.ZXing;
    try {
      const src = new ZX.HTMLCanvasElementLuminanceSource(c);
      const bmp = new ZX.BinaryBitmap(new ZX.HybridBinarizer(src));
      const r = zxReader.decode(bmp);
      return { code: r.getText(), format: ZXING_TO_FORMAT[ZX.BarcodeFormat[r.getBarcodeFormat()]] || 'CODE128' };
    } catch (_) {
      return null;
    } finally {
      try { zxReader.reset(); } catch (_) {}
    }
  }

  /* Prova a leggere un codice da un'immagine/canvas/video. */
  async function decodeSource(source, w, h) {
    const det = await getDetector();
    if (det) {
      try {
        const res = await det.detect(source);
        if (res && res.length) {
          return { code: res[0].rawValue, format: ZXING_TO_FORMAT[res[0].format] || 'CODE128' };
        }
      } catch (_) {}
      return null;
    }
    await getZxReader();
    if (!canvas) canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return zxDecodeCanvas(canvas);
  }

  async function decodeFile(file) {
    const img = await loadImage(file);
    const w = img.naturalWidth, h = img.naturalHeight;
    let r = await decodeSource(img, w, h);
    if (r) return r;
    // Riprova con l'immagine ruotata di 90° (foto in verticale).
    const c = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(w, h));
    c.width = Math.round(h * scale);
    c.height = Math.round(w * scale);
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
    r = await decodeSource(c, c.width, c.height);
    return r;
  }

  async function start(video, cb) {
    onFound = cb;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('nocamera');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    // Pre-carica il lettore se non c'è quello nativo.
    if (!(await getDetector())) await getZxReader();
    running = true;
    loop(video);
    return stream;
  }

  async function loop(video) {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const r = await decodeSource(video, video.videoWidth, video.videoHeight);
      if (r && r.code && running) {
        const cb = onFound;
        stop();
        cb && cb(r);
        return;
      }
    }
    timer = setTimeout(() => loop(video), 120);
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  async function torch(on) {
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch (_) { return false; }
  }
  function hasTorch() {
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    return !!caps.torch;
  }

  return { start, stop, decodeFile, torch, hasTorch };
})();

/* =========================================================
 * Navigazione tra le schermate
 * ======================================================= */
const state = {
  cards: [],
  current: null,      // carta mostrata
  editing: null,      // carta in modifica (o null per nuova)
  formPhoto: null,    // dataURL foto nel modulo
  formColor: null,
  formFormat: 'auto', // formato rilevato dalla scansione
  stack: ['home'],
};

let extraEntry = false;  // c'è una voce in più nella cronologia (per il tasto Indietro di Android)
let ignorePop = false;

function activate(view) {
  const prev = document.querySelector('.view.active');
  const prevId = prev ? prev.id.replace('view-', '') : null;
  if (prevId === 'scan' && view !== 'scan') Scanner.stop();
  if (prevId === 'show' && view !== 'show') releaseWakeLock();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'home') renderList();
  window.scrollTo(0, 0);
}
function show(view) {
  state.stack.push(view);
  activate(view);
  if (state.stack.length > 1 && !extraEntry) {
    history.pushState({ carte: 1 }, '');
    extraEntry = true;
  }
}
/* Sostituisce la schermata attuale (es. scanner -> modulo). */
function replaceView(view) {
  state.stack[state.stack.length - 1] = view;
  activate(view);
}
function popView() {
  if (state.stack.length > 1) state.stack.pop();
  activate(state.stack[state.stack.length - 1]);
}
function back() {
  if (extraEntry && state.stack.length === 2) { history.back(); return; }
  popView();
}
window.addEventListener('popstate', () => {
  extraEntry = false;
  if (ignorePop) { ignorePop = false; return; }
  popView();
  if (state.stack.length > 1) { history.pushState({ carte: 1 }, ''); extraEntry = true; }
});
function goHome() {
  state.stack = ['home'];
  activate('home');
  if (extraEntry) { ignorePop = true; history.back(); }
}

/* =========================================================
 * HOME: elenco carte
 * ======================================================= */
async function loadCards() {
  state.cards = (await DB.all()).sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
}

function renderList() {
  const list = $('#card-list');
  const q = ($('#search').value || '').trim().toLowerCase();
  const cards = q ? state.cards.filter(c => c.name.toLowerCase().includes(q) || (c.notes || '').toLowerCase().includes(q)) : state.cards;
  list.innerHTML = '';
  $('#empty').hidden = state.cards.length > 0;
  $('#search-wrap').hidden = state.cards.length < 6;
  for (const c of cards) {
    const b = document.createElement('button');
    b.className = 'card-tile' + (isLight(c.color) ? ' light-bg' : '');
    b.style.background = c.color;
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-label', 'Mostra carta ' + c.name);
    const init = document.createElement('span');
    init.className = 'tile-initial';
    init.textContent = c.name.trim().charAt(0).toUpperCase();
    const nm = document.createElement('span');
    nm.className = 'tile-name';
    nm.textContent = c.name;
    b.append(init, nm);
    b.addEventListener('click', () => openCard(c.id));
    list.appendChild(b);
  }
  if (q && !cards.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.style.gridColumn = '1 / -1';
    p.textContent = 'Nessuna carta trovata.';
    list.appendChild(p);
  }
}

/* =========================================================
 * MOSTRA CARTA (da far leggere alla cassa)
 * ======================================================= */
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch (_) {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#view-show').classList.contains('active')) requestWakeLock();
});

async function openCard(id) {
  const c = await DB.get(id);
  if (!c) return;
  state.current = c;
  $('#show-title').textContent = c.name;
  $('#show-band').style.background = c.color;
  const used = renderBarcode($('#show-barcode'), c.code, c.format);
  if (!used) $('#show-barcode').innerHTML = '<p class="error">Impossibile disegnare il codice. Mostra il numero alla cassa.</p>';
  $('#show-code').textContent = formatCodeForReading(c.code);
  $('#show-notes').hidden = !c.notes;
  $('#show-notes').textContent = c.notes || '';
  const ph = $('#show-photo');
  ph.hidden = !c.photo;
  if (c.photo) ph.src = c.photo; else ph.removeAttribute('src');
  show('show');
  requestWakeLock();
}
function formatCodeForReading(code) {
  // Raggruppa le cifre a blocchi di 4 per leggerle meglio a voce.
  if (/^\d{9,}$/.test(code)) return code.replace(/(\d{4})(?=\d)/g, '$1 ');
  return code;
}

/* =========================================================
 * MODULO: nuova carta / modifica
 * ======================================================= */
function buildColorSwatches() {
  const wrap = $('#f-colors');
  wrap.innerHTML = '';
  COLORS.forEach(col => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch';
    s.style.background = col;
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-label', 'Colore ' + col);
    s.dataset.color = col;
    s.addEventListener('click', () => selectColor(col));
    wrap.appendChild(s);
  });
}
function selectColor(col) {
  state.formColor = col;
  document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-checked', String(s.dataset.color === col)));
}

function openForm({ card = null, code = '', format = 'auto', fromScan = false, replace = false } = {}) {
  state.editing = card;
  $('#form-title').textContent = card ? 'Modifica carta' : 'Dati della carta';
  $('#f-name').value = card ? card.name : '';
  $('#f-code').value = card ? card.code : code;
  $('#f-format').value = card ? (card.format || 'auto') : format;
  $('#f-notes').value = card ? (card.notes || '') : '';
  state.formPhoto = card ? (card.photo || null) : null;
  state.formColor = card ? card.color : null;
  selectColor(state.formColor);
  updatePhotoPreview();
  $('#scan-ok').hidden = !fromScan;
  $('#form-error').hidden = true;
  if (fromScan && format !== 'auto') $('#f-format').closest('details').open = false;
  updateFormPreview();
  if (replace) replaceView('form'); else show('form');
  if (!card) setTimeout(() => $('#f-name').focus(), 250);
}

function updateFormPreview() {
  const code = $('#f-code').value.trim();
  const fmt = $('#f-format').value;
  const box = $('#form-preview');
  const warn = $('#form-format-warning');
  warn.hidden = true;
  if (!code) {
    box.innerHTML = '<p class="muted small">L\'anteprima del codice comparirà qui</p>';
    return;
  }
  const used = renderBarcode(box, code, fmt, { small: true });
  if (!used) {
    box.innerHTML = '<p class="error small">Questo numero non può essere trasformato in codice.</p>';
  } else if (fmt !== 'auto' && used !== fmt) {
    warn.textContent = 'Il numero non è valido per il tipo scelto: verrà usato Code 128.';
    warn.hidden = false;
  }
}

function updatePhotoPreview() {
  const img = $('#f-photo-preview');
  img.hidden = !state.formPhoto;
  if (state.formPhoto) img.src = state.formPhoto; else img.removeAttribute('src');
  $('#f-photo-remove').hidden = !state.formPhoto;
  $('#f-photo-btn').textContent = state.formPhoto ? '📷 Cambia foto' : '📷 Aggiungi foto';
}

async function saveForm(ev) {
  ev.preventDefault();
  const name = $('#f-name').value.trim();
  const code = $('#f-code').value.trim();
  const err = $('#form-error');
  if (!name) { err.textContent = 'Scrivi il nome del negozio.'; err.hidden = false; $('#f-name').focus(); return; }
  if (!code) { err.textContent = 'Scrivi il numero della carta.'; err.hidden = false; $('#f-code').focus(); return; }

  let format = $('#f-format').value;
  const test = document.createElement('div');
  const used = renderBarcode(test, code, format);
  if (!used) { err.textContent = 'Questo numero non può essere trasformato in codice. Controlla di averlo scritto bene.'; err.hidden = false; return; }
  if (format !== 'auto') format = used;

  const now = Date.now();
  const card = {
    id: state.editing ? state.editing.id : uid(),
    name,
    code,
    format,
    color: state.formColor || colorFor(name),
    notes: $('#f-notes').value.trim(),
    photo: state.formPhoto || null,
    created: state.editing ? state.editing.created : now,
    updated: now,
  };
  try {
    await DB.put(card);
  } catch (e) {
    err.textContent = 'Non è stato possibile salvare: memoria del telefono piena?';
    err.hidden = false;
    return;
  }
  await loadCards();
  vibrate(30);
  toast(state.editing ? 'Carta aggiornata ✔' : 'Carta salvata ✔');
  // Dopo il salvataggio mostra subito la carta (Indietro riporta alla home).
  state.stack = ['home'];
  openCard(card.id);
}

/* =========================================================
 * SCANSIONE
 * ======================================================= */
let torchOn = false;
async function startCameraScan() {
  show('scan');
  $('#scan-hint').textContent = 'Tieni la carta ferma dentro il riquadro, con il codice a barre orizzontale e ben illuminato.';
  $('#btn-torch').hidden = true;
  torchOn = false;
  try {
    await Scanner.start($('#scan-video'), onScanned);
    $('#btn-torch').hidden = !Scanner.hasTorch();
  } catch (e) {
    let msg = 'Non riesco ad aprire la fotocamera.';
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      msg = 'Serve il permesso per usare la fotocamera. Consentilo nelle impostazioni del telefono, oppure scrivi il numero a mano.';
    } else if (e && e.message === 'nocamera') {
      msg = 'Questo dispositivo non permette di usare la fotocamera qui. Usa "Da una foto" oppure scrivi il numero a mano.';
    }
    $('#scan-hint').textContent = msg;
  }
}
function onScanned(r) {
  vibrate([60, 40, 60]);
  // Sostituisce la schermata scanner con il modulo (così "Indietro" torna alla scelta).
  openForm({ code: r.code, format: r.format, fromScan: true, replace: true });
}

async function scanFromPhoto(file) {
  if (!file) return;
  toast('Sto leggendo la foto…', 8000);
  try {
    const r = await Scanner.decodeFile(file);
    $('#toast').hidden = true;
    if (r && r.code) {
      vibrate([60, 40, 60]);
      openForm({ code: r.code, format: r.format, fromScan: true });
      // Conserva la foto come immagine della carta.
      try { state.formPhoto = await shrinkPhoto(file); updatePhotoPreview(); } catch (_) {}
    } else {
      toast('Non ho trovato un codice nella foto. Prova con una foto più vicina e nitida, oppure scrivi il numero a mano.', 5500);
    }
  } catch (e) {
    toast('Non riesco a leggere la foto.', 4000);
  }
}

/* =========================================================
 * BACKUP
 * ======================================================= */
async function exportBackup() {
  const cards = await DB.all();
  if (!cards.length) { toast('Non ci sono carte da salvare.'); return; }
  const data = JSON.stringify({ app: 'carteplus', version: 1, exported: new Date().toISOString(), cards }, null, 1);
  const d = new Date();
  const fname = `carte-fedelta-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([data], fname, { type: 'application/json' });
  // Su telefono, il menu Condividi permette di salvarla in File/Drive o mandarla via WhatsApp/email.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia carte fedeltà' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Copia salvata nei download ✔');
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const cards = Array.isArray(data) ? data : data.cards;
    if (!Array.isArray(cards)) throw new Error('formato');
    let n = 0;
    for (const c of cards) {
      if (!c || !c.name || !c.code) continue;
      await DB.put({
        id: c.id || uid(),
        name: String(c.name).slice(0, 40),
        code: String(c.code),
        format: c.format || 'auto',
        color: c.color || colorFor(c.name),
        notes: c.notes || '',
        photo: typeof c.photo === 'string' && c.photo.startsWith('data:image/') ? c.photo : null,
        created: c.created || Date.now(),
        updated: c.updated || Date.now(),
      });
      n++;
    }
    await loadCards();
    renderList();
    toast(n ? `Recuperate ${n} carte ✔` : 'Nessuna carta trovata nel file.');
  } catch (e) {
    toast('Questo file non è una copia valida di Carte+.', 4000);
  }
}

/* =========================================================
 * IMPOSTAZIONI / INSTALLAZIONE
 * ======================================================= */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  updateInstallUI();
});
window.addEventListener('appinstalled', () => { installPrompt = null; updateInstallUI(); toast('App installata ✔'); });

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function updateInstallUI() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = isStandalone();
  $('#btn-install').hidden = installed || !installPrompt;
  $('#install-steps-ios').hidden = installed || !ios;
  $('#install-steps-android').hidden = installed || ios || !!installPrompt;
  $('#install-text').textContent = installed
    ? '✅ L\'app è già sulla schermata Home. Funziona anche senza internet.'
    : 'Così la apri con un tocco, come le altre app, e funziona anche senza internet.';
}

async function updateSettingsInfo() {
  updateInstallUI();
  $('#app-version').textContent = APP_VERSION;
  const swOk = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
  $('#status-offline').textContent = swOk
    ? '✅ Pronta per funzionare senza internet.'
    : '⏳ Preparazione per l\'uso senza internet… riapri l\'app tra un momento.';
  try {
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    $('#status-storage').textContent = `Carte salvate: ${state.cards.length}.` + (persisted ? ' Memoria protetta dalla cancellazione automatica.' : '');
  } catch (_) {
    $('#status-storage').textContent = `Carte salvate: ${state.cards.length}.`;
  }
}

/* =========================================================
 * Avvio
 * ======================================================= */
function bind() {
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));
  $('#btn-add').addEventListener('click', () => show('add'));
  $('#btn-settings').addEventListener('click', () => { show('settings'); updateSettingsInfo(); });
  $('#search').addEventListener('input', renderList);

  $('#btn-scan-camera').addEventListener('click', startCameraScan);
  $('#btn-scan-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', e => { scanFromPhoto(e.target.files[0]); e.target.value = ''; });
  $('#btn-manual').addEventListener('click', () => openForm());

  $('#scan-cancel').addEventListener('click', back);
  $('#scan-to-manual').addEventListener('click', () => {
    openForm({ replace: true });
  });
  $('#btn-torch').addEventListener('click', async () => {
    torchOn = !torchOn;
    const ok = await Scanner.torch(torchOn);
    if (!ok) { torchOn = false; toast('Torcia non disponibile.'); }
    $('#btn-torch').textContent = torchOn ? '🔦 Spegni torcia' : '🔦 Torcia';
  });

  $('#card-form').addEventListener('submit', saveForm);
  $('#f-code').addEventListener('input', updateFormPreview);
  $('#f-format').addEventListener('change', updateFormPreview);
  $('#f-name').addEventListener('input', () => { if (!state.formColor) selectColor(null); });
  $('#f-photo-btn').addEventListener('click', () => $('#f-photo-input').click());
  $('#f-photo-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { state.formPhoto = await shrinkPhoto(f); updatePhotoPreview(); } catch (_) { toast('Foto non leggibile.'); }
  });
  $('#f-photo-remove').addEventListener('click', () => { state.formPhoto = null; updatePhotoPreview(); });

  $('#btn-edit').addEventListener('click', () => openForm({ card: state.current }));
  $('#btn-delete').addEventListener('click', async () => {
    const c = state.current;
    if (!c) return;
    if (await confirmDialog(`Eliminare la carta "${c.name}"?`)) {
      await DB.remove(c.id);
      await loadCards();
      toast('Carta eliminata');
      goHome();
    }
  });

  $('#btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    updateInstallUI();
  });
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', e => { importBackup(e.target.files[0]); e.target.value = ''; });
}

async function init() {
  buildColorSwatches();
  $('#store-list').innerHTML = STORES.map(s => `<option value="${s.replace(/"/g, '&quot;')}"></option>`).join('');
  bind();
  try {
    await loadCards();
  } catch (e) {
    toast('Errore nell\'apertura dell\'archivio delle carte.', 5000);
  }
  renderList();

  // Chiede al browser di non cancellare mai i dati.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
