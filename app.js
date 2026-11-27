/* Carte+ — carte fedeltà offline. Tutto resta sul telefono (IndexedDB). */
'use strict';

const APP_VERSION = '1.2.0';

/* =========================================================
 * Archivio (IndexedDB)
 *
 * L'archivio si apre SEMPRE alla versione già presente sul telefono, senza
 * mai richiedere aggiornamenti di struttura: così nessuna versione dell'app
 * può restare bloccata o rendere invisibili le carte salvate da un'altra.
 *  - "cards": dati delle carte
 *  - "photos": foto separate (se l'archivio le prevede); altrimenti la foto
 *    resta dentro la carta. Entrambi i casi sono gestiti.
 * ======================================================= */
const DB = (() => {
  let dbp = null;
  let hasPhotoStore = false;
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  function openRaw(version) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open('carteplus', version) : indexedDB.open('carteplus');
      let settled = false;
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      req.onsuccess = () => { settled = true; resolve(req.result); };
      req.onerror = () => { settled = true; reject(req.error); };
      req.onblocked = () => {
        setTimeout(() => { if (!settled) toast('Chiudi le altre finestre di Carte+ e riapri l\'app. Le tue carte sono al sicuro.', { ms: 15000 }); }, 1500);
      };
    });
  }

  function open() {
    if (dbp) return dbp;
    dbp = (async () => {
      let db = await openRaw();
      // Caso rarissimo: archivio senza la tabella delle carte -> la crea.
      if (!db.objectStoreNames.contains('cards')) {
        const v = db.version + 1;
        db.close();
        db = await openRaw(v);
      }
      hasPhotoStore = db.objectStoreNames.contains('photos');
      // Se un'altra finestra deve modificare l'archivio, lasciala fare e riapri dopo.
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      return db;
    })();
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  async function run(storeNames, mode, fn) {
    const db = await open();
    const stores = storeNames.filter(n => n !== 'photos' || hasPhotoStore);
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then(r => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abort'));
    });
  }

  /* Versione "leggera" di una carta (senza foto incorporata). */
  function light(r) {
    if (!r) return r;
    if (r.photo) { const c = { ...r, hasPhoto: true }; delete c.photo; return c; }
    return r;
  }

  return {
    all: () => run(['cards'], 'readonly', t => reqP(t.objectStore('cards').getAll())).then(list => list.filter(c => c && c.id && c.name).map(light)),
    get: id => run(['cards'], 'readonly', t => reqP(t.objectStore('cards').get(id))).then(light),
    photo: id => run(['cards', 'photos'], 'readonly', async t => {
      if (hasPhotoStore) {
        const p = await reqP(t.objectStore('photos').get(id));
        if (p && p.data) return p.data;
      }
      const c = await reqP(t.objectStore('cards').get(id));
      return (c && c.photo) || null;
    }),
    allPhotos: () => run(['cards', 'photos'], 'readonly', async t => {
      const map = new Map();
      const cards = await reqP(t.objectStore('cards').getAll());
      cards.forEach(c => { if (c && c.photo) map.set(c.id, c.photo); });
      if (hasPhotoStore) (await reqP(t.objectStore('photos').getAll())).forEach(p => map.set(p.id, p.data));
      return map;
    }),
    /* photo: stringa = salva, null = elimina, undefined = lascia com'è */
    put: (card, photo) => run(['cards', 'photos'], 'readwrite', t => {
      const cards = t.objectStore('cards');
      const c = { ...card };
      delete c.photo;
      if (hasPhotoStore) {
        if (photo !== undefined) {
          if (photo) { t.objectStore('photos').put({ id: c.id, data: photo }); c.hasPhoto = true; }
          else { t.objectStore('photos').delete(c.id); c.hasPhoto = false; }
        }
        cards.put(c);
        return;
      }
      // Archivio senza tabella foto: la foto sta dentro la carta.
      if (photo !== undefined) {
        c.photo = photo || null;
        c.hasPhoto = !!photo;
        cards.put(c);
        return;
      }
      cards.get(c.id).onsuccess = e => {
        const old = e.target.result;
        c.photo = (old && old.photo) || null;
        c.hasPhoto = !!c.photo;
        cards.put(c);
      };
    }),
    remove: id => run(['cards', 'photos'], 'readwrite', t => {
      t.objectStore('cards').delete(id);
      if (hasPhotoStore) t.objectStore('photos').delete(id);
    }),
  };
})();

/* =========================================================
 * Utilità
 * ======================================================= */
const $ = sel => document.querySelector(sel);

const COLORS = ['#d32f2f', '#ef6c00', '#f6b400', '#2e7d32', '#00897b', '#0277bd',
  '#1f4e8c', '#5e35b1', '#c2185b', '#6d4c41', '#455a64', '#111111'];

/* Negozi suggeriti; alcuni con il loro colore tipico. */
const STORES = [
  ['Conad', '#e30613'], ['Coop', '#e2001a'], ['Esselunga'], ['Carrefour', '#004e9f'], ['Lidl', '#0050aa'],
  ['Eurospin', '#00439c'], ['Pam'], ['Despar', '#00843d'], ['Interspar', '#00843d'], ['Eurospar', '#00843d'],
  ['Famila'], ['Bennet'], ['Iper'], ['Il Gigante'], ['Iperal'], ['Unes'], ['Tigros'], ['Crai'], ['Sigma'],
  ['Sisa'], ['Penny', '#cd1316'], ['MD'], ['Todis'], ['Tuodì'], ['Basko'], ['Decò'], ['Tigotà'],
  ['Acqua & Sapone'], ['Caddy\'s'], ['Douglas'], ['Sephora', '#111111'], ['Kiko'], ['Feltrinelli'],
  ['Mondadori'], ['MediaWorld', '#df0000'], ['Unieuro'], ['Euronics'], ['Expert'], ['Trony'],
  ['Decathlon', '#0082c3'], ['IKEA Family', '#0058a3'], ['Leroy Merlin', '#78be20'], ['Brico'], ['OBI', '#ff7e21'],
  ['Bricocenter'], ['OVS'], ['Coin'], ['Upim'], ['Calzedonia'], ['Intimissimi'], ['Tezenis'], ['Yamamay'],
  ['Pittarello'], ['Arcaplanet'], ['Maxi Zoo'], ['Farmacia', '#2e7d32'], ['Eni'], ['Q8'], ['IP'], ['Esso'],
  ['Tamoil'], ['Autogrill'], ['Trenitalia'], ['Italo'], ['Biblioteca'], ['Palestra'], ['Ottico'],
];
const STORE_COLOR = new Map(STORES.filter(s => s[1]).map(([n, c]) => [n.toLowerCase(), c]));
const POPULAR = ['Conad', 'Coop', 'Esselunga', 'Carrefour', 'Lidl', 'Eurospin', 'Despar', 'Pam'];

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
function colorFor(name) {
  const known = STORE_COLOR.get((name || '').trim().toLowerCase());
  if (known) return known;
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % (COLORS.length - 1)];
}
function isLight(hex) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 175;
}
function paint(el, color) {
  el.style.setProperty('--c', color);
  el.classList.toggle('light-bg', isLight(color));
}
function lastDigits(code) {
  const s = String(code || '').replace(/\s+/g, '');
  if (s.length <= 4) return s;
  return '•••• ' + s.slice(-4);
}
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function toast(msg, { ms = 2600, action = null, onAction = null } = {}) {
  const t = $('#toast');
  $('#toast-text').textContent = msg;
  const btn = $('#toast-action');
  btn.hidden = !action;
  btn.textContent = action || '';
  btn.onclick = action ? () => { t.hidden = true; onAction && onAction(); } : null;
  t.hidden = false;
  // riavvia l'animazione
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function hideToast() { $('#toast').hidden = true; }

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

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
    img.src = url;
  });
}
/* Riduce una foto per non occupare troppo spazio. */
async function shrinkPhoto(fileOrImg, max = 1000) {
  const img = fileOrImg instanceof HTMLImageElement ? fileOrImg : await loadImage(fileOrImg);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}

/* =========================================================
 * Disegno del codice a barre
 * ======================================================= */
const ZXING_TO_FORMAT = {
  EAN_13: 'EAN13', ean_13: 'EAN13', EAN_8: 'EAN8', ean_8: 'EAN8',
  UPC_A: 'UPC', upc_a: 'UPC', UPC_E: 'UPCE', upc_e: 'UPCE',
  CODE_128: 'CODE128', code_128: 'CODE128', CODE_39: 'CODE39', code_39: 'CODE39',
  CODE_93: 'CODE128', code_93: 'CODE128', ITF: 'ITF', itf: 'ITF',
  CODABAR: 'codabar', codabar: 'codabar', QR_CODE: 'QR', qr_code: 'QR',
};

function validEan(code) {
  const d = code.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}
/* Indovina il formato più probabile dal solo numero. */
function guessFormat(code) {
  if (/^\d{13}$/.test(code) && validEan(code)) return 'EAN13';
  if (/^\d{8}$/.test(code) && validEan(code)) return 'EAN8';
  if (/^\d{12}$/.test(code) && validEan('0' + code)) return 'UPC';
  if (code.length > 60 || /^https?:\/\//i.test(code)) return 'QR';
  return 'CODE128';
}

/* Cache dei disegni già fatti: riaprire una carta è istantaneo. */
const svgCache = new Map();

function makeBarcodeSvg(code, format, size) {
  const key = `${size}|${format}|${code}`;
  if (svgCache.has(key)) return svgCache.get(key);
  let fmt = format && format !== 'auto' ? format : guessFormat(code);
  let out = null;

  if (fmt === 'QR') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(unescape(encodeURIComponent(code)));
      qr.make();
      out = { html: qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true }), fmt: 'QR' };
    } catch (_) { out = null; }
  } else {
    const dims = { small: [2, 70, 6], large: [3, 150, 16], zoom: [3, 100, 8] }[size] || [3, 150, 16];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const settings = {
      format: fmt, width: dims[0], height: dims[1], displayValue: false,
      margin: dims[2], background: '#ffffff', lineColor: '#000000',
    };
    try {
      JsBarcode(svg, code, settings);
      out = { html: svg.outerHTML, fmt };
    } catch (_) {
      // Numero non compatibile col formato: ripiega su Code 128, che accetta tutto.
      if (fmt !== 'CODE128') {
        try { JsBarcode(svg, code, { ...settings, format: 'CODE128' }); out = { html: svg.outerHTML, fmt: 'CODE128' }; } catch (__) {}
      }
    }
  }
  if (svgCache.size > 60) svgCache.clear();
  svgCache.set(key, out);
  return out;
}

/* Disegna il codice dentro `box`. Ritorna il formato effettivamente usato o null. */
function renderBarcode(box, code, format, size = 'large') {
  box.classList.remove('qr');
  if (!code) { box.innerHTML = ''; return null; }
  const r = makeBarcodeSvg(code, format, size);
  if (!r) { box.innerHTML = ''; return null; }
  box.innerHTML = r.html;
  box.classList.toggle('qr', r.fmt === 'QR');
  return r.fmt;
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
  let frame = 0;

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
    const F = ZX.BarcodeFormat;
    const hints = new Map();
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
      const r = zxReader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(src)));
      return { code: r.getText(), format: ZXING_TO_FORMAT[ZX.BarcodeFormat[r.getBarcodeFormat()]] || 'CODE128' };
    } catch (_) {
      return null;
    } finally {
      try { zxReader.reset(); } catch (_) {}
    }
  }

  /* Copia (una parte di) source su canvas, rimpicciolendo se serve, e decodifica con ZXing. */
  function zxDecodeRegion(source, sx, sy, sw, sh, maxSide) {
    if (!canvas) canvas = document.createElement('canvas');
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return zxDecodeCanvas(canvas);
  }

  async function nativeDetect(source) {
    try {
      const res = await detector.detect(source);
      if (res && res.length) return { code: res[0].rawValue, format: ZXING_TO_FORMAT[res[0].format] || 'CODE128' };
    } catch (_) {}
    return null;
  }

  async function decodeImage(source, w, h) {
    if (await getDetector()) return nativeDetect(source);
    await getZxReader();
    return zxDecodeRegion(source, 0, 0, w, h, 1600);
  }

  async function decodeFile(file) {
    const img = await loadImage(file);
    const w = img.naturalWidth, h = img.naturalHeight;
    let r = await decodeImage(img, w, h);
    if (!r) {
      // Riprova con l'immagine ruotata di 90° (codice in verticale).
      const c = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(w, h));
      c.width = Math.round(h * scale);
      c.height = Math.round(w * scale);
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
      r = await decodeImage(c, c.width, c.height);
    }
    return r ? { ...r, img } : { img };
  }

  async function start(video, cb) {
    onFound = cb;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocamera');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    // Messa a fuoco continua dove supportata.
    try {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (_) {}
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (!(await getDetector())) await getZxReader();
    running = true;
    frame = 0;
    loop(video);
    return stream;
  }

  /* Su iPhone (senza lettore nativo) analizza soprattutto la fascia centrale:
     meno pixel = lettura molto più rapida. Ogni tanto prova l'immagine intera. */
  async function decodeVideo(video) {
    const w = video.videoWidth, h = video.videoHeight;
    if (await getDetector()) return nativeDetect(video);
    frame++;
    if (frame % 4 === 0) return zxDecodeRegion(video, 0, 0, w, h, 1000);
    const bandH = Math.round(h * 0.45);
    return zxDecodeRegion(video, Math.round(w * 0.04), Math.round((h - bandH) / 2), Math.round(w * 0.92), bandH, 1100);
  }

  async function loop(video) {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const r = await decodeVideo(video);
      if (r && r.code && running) {
        const cb = onFound;
        stop();
        cb && cb(r);
        return;
      }
    }
    if (!running) return;
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => { timer = setTimeout(() => loop(video), 40); });
    else timer = setTimeout(() => loop(video), 90);
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

  /* Prepara il lettore in anticipo (mentre l'utente sceglie). */
  function warmUp() { getDetector().then(d => { if (!d) loadZxing().catch(() => {}); }); }

  return { start, stop, decodeFile, torch, hasTorch, warmUp };
})();

/* =========================================================
 * Navigazione tra le schermate
 * ======================================================= */
const state = {
  cards: [],
  current: null,      // carta mostrata
  editing: null,      // carta in modifica (o null per nuova)
  formPhoto: undefined, // undefined = invariata, null = rimossa, stringa = nuova
  formPhotoShown: null,
  formColor: null,
  colorTouched: false,
  stack: ['home'],
};

let extraEntry = false;  // c'è una voce in più nella cronologia (per il tasto Indietro di Android)
let ignorePop = false;

function activate(view) {
  const prev = document.querySelector('.view.active');
  const prevId = prev ? prev.id.replace('view-', '') : null;
  if (prevId === 'scan' && view !== 'scan') Scanner.stop();
  if (prevId === 'show' && view !== 'show') { releaseWakeLock(); closeZoom(); }
  if (prevId !== view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  }
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
  // Il tasto Indietro chiude prima il codice ingrandito.
  if (!$('#zoom').hidden) {
    closeZoom();
  } else {
    popView();
  }
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

function tileFor(c) {
  const b = document.createElement('button');
  b.className = 'card-tile';
  paint(b, c.color);
  b.setAttribute('role', 'listitem');
  b.setAttribute('aria-label', 'Mostra carta ' + c.name);
  b.dataset.id = c.id;
  b.innerHTML = `${c.fav ? '<span class="tile-star" aria-hidden="true">⭐</span>' : ''}<span class="tile-name"></span>
    <span class="tile-foot"><span class="tile-digits"></span><span class="tile-chip" aria-hidden="true"></span></span>`;
  b.querySelector('.tile-name').textContent = c.name;
  b.querySelector('.tile-digits').textContent = lastDigits(c.code);
  return b;
}

function renderList() {
  const q = norm($('#search').value.trim());
  const all = state.cards;
  const cards = q ? all.filter(c => norm(c.name).includes(q) || norm(c.notes).includes(q) || c.code.includes(q)) : all;
  const favs = q ? [] : cards.filter(c => c.fav);
  const rest = q ? cards : cards.filter(c => !c.fav);

  const favList = $('#fav-list'), list = $('#card-list');
  const f1 = document.createDocumentFragment(), f2 = document.createDocumentFragment();
  favs.forEach(c => f1.appendChild(tileFor(c)));
  rest.forEach(c => f2.appendChild(tileFor(c)));
  favList.replaceChildren(f1);
  list.replaceChildren(f2);

  $('#fav-title').hidden = favs.length === 0;
  $('#all-title').hidden = favs.length === 0 || rest.length === 0;
  $('#no-results').hidden = !(q && cards.length === 0);
  $('#empty').hidden = all.length > 0;
  $('#search-wrap').hidden = all.length < 6;
  $('#home-count').textContent = all.length === 0 ? '' : all.length === 1 ? '1 carta' : `${all.length} carte`;
}

/* =========================================================
 * MOSTRA CARTA (da far leggere alla cassa)
 * ======================================================= */
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) {}
}
function releaseWakeLock() {
  try { wakeLock && wakeLock.release(); } catch (_) {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#view-show').classList.contains('active')) requestWakeLock();
});

function formatCodeForReading(code) {
  // Raggruppa le cifre a blocchi di 4 per leggerle meglio a voce.
  if (/^\d{9,}$/.test(code)) return code.replace(/(\d{4})(?=\d)/g, '$1 ');
  return code;
}

async function openCard(id) {
  const c = state.cards.find(x => x.id === id) || await DB.get(id);
  if (!c) return;
  state.current = c;
  $('#show-title').textContent = c.name;
  paint($('#show-hero'), c.color);
  const used = renderBarcode($('#show-barcode'), c.code, c.format);
  if (!used) $('#show-barcode').innerHTML = '<p class="error">Impossibile disegnare il codice. Detta il numero alla cassa.</p>';
  $('#show-code').textContent = formatCodeForReading(c.code);
  $('#show-notes').hidden = !c.notes;
  $('#show-notes').textContent = c.notes || '';
  setFavButton(!!c.fav);
  const ph = $('#show-photo');
  ph.hidden = true;
  ph.removeAttribute('src');
  show('show');
  requestWakeLock();
  if (c.hasPhoto) {
    const data = await DB.photo(c.id).catch(() => null);
    if (data && state.current && state.current.id === c.id) { ph.src = data; ph.hidden = false; }
  }
}
function setFavButton(on) {
  const b = $('#btn-fav');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Togli dalle preferite' : 'Metti tra le preferite');
}
async function toggleFav() {
  const c = state.current;
  if (!c) return;
  c.fav = !c.fav;
  setFavButton(c.fav);
  vibrate(15);
  await DB.put(c);
  await loadCards();
  toast(c.fav ? '⭐ Aggiunta alle preferite' : 'Tolta dalle preferite');
}

/* Codice a tutto schermo, girato in orizzontale per renderlo più grande. */
function openZoom() {
  const c = state.current;
  if (!c) return;
  const inner = $('#zoom-inner');
  const fmt = renderBarcode($('#zoom-code'), c.code, c.format, 'zoom');
  hideToast();
  if (!fmt) return;
  inner.classList.toggle('qr', fmt === 'QR');
  $('#zoom-num').textContent = formatCodeForReading(c.code);
  $('#zoom').hidden = false;
  vibrate(10);
}
function closeZoom() { $('#zoom').hidden = true; }

async function copyCode() {
  const c = state.current;
  if (!c) return;
  try {
    await navigator.clipboard.writeText(c.code);
    toast('Numero copiato ✔');
  } catch (_) {
    toast('Non è stato possibile copiare.');
  }
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
    s.className = 'swatch' + (isLight(col) ? ' light' : '');
    s.style.background = col;
    s.setAttribute('role', 'radio');
    s.setAttribute('aria-checked', 'false');
    s.setAttribute('aria-label', 'Colore ' + (COLORS.indexOf(col) + 1));
    s.dataset.color = col;
    s.addEventListener('click', () => { state.colorTouched = true; selectColor(col); });
    wrap.appendChild(s);
  });
}
function selectColor(col) {
  state.formColor = col;
  document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-checked', String(s.dataset.color === col)));
  updateCardPreview();
}
function currentFormColor() {
  return state.formColor || colorFor($('#f-name').value.trim());
}
function updateCardPreview() {
  const name = $('#f-name').value.trim();
  $('#cp-name').textContent = name || 'Nome negozio';
  $('#cp-digits').textContent = lastDigits($('#f-code').value.trim());
  paint($('#card-preview'), currentFormColor());
}

function renderChips() {
  const wrap = $('#name-chips');
  const q = norm($('#f-name').value.trim());
  let list;
  if (!q) list = POPULAR.map(n => STORES.find(s => s[0] === n));
  else list = STORES.filter(([n]) => norm(n).startsWith(q) && norm(n) !== q)
    .concat(STORES.filter(([n]) => !norm(n).startsWith(q) && norm(n).includes(q)));
  list = list.slice(0, 6);
  const frag = document.createDocumentFragment();
  for (const [n] of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.innerHTML = '<i aria-hidden="true"></i>';
    b.querySelector('i').style.background = colorFor(n);
    b.append(n);
    b.addEventListener('click', () => {
      $('#f-name').value = n;
      onNameInput();
      vibrate(10);
      if (!$('#f-code').value.trim()) $('#f-code').focus();
    });
    frag.appendChild(b);
  }
  wrap.replaceChildren(frag);
  wrap.hidden = list.length === 0;
}
function onNameInput() {
  if (!state.colorTouched) {
    state.formColor = null;
    document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-checked', String(s.dataset.color === colorFor($('#f-name').value.trim()))));
  }
  updateCardPreview();
  renderChips();
  $('#form-error').hidden = true;
}

function openForm({ card = null, code = '', format = 'auto', fromScan = false, replace = false, photo } = {}) {
  state.editing = card;
  $('#form-title').textContent = card ? 'Modifica carta' : 'Nuova carta';
  $('#f-name').value = card ? card.name : '';
  $('#f-code').value = card ? card.code : code;
  $('#f-format').value = card ? (card.format || 'auto') : format;
  $('#f-notes').value = card ? (card.notes || '') : '';
  $('#f-fav').checked = card ? !!card.fav : false;
  state.formPhoto = photo !== undefined ? photo : (card ? undefined : null);
  state.formPhotoShown = typeof photo === 'string' ? photo : null;
  state.colorTouched = !!card;
  state.formColor = card ? card.color : null;
  selectColor(state.formColor);
  onNameInput();
  updatePhotoPreview();
  if (card && card.hasPhoto) {
    DB.photo(card.id).then(d => { if (state.editing === card && state.formPhoto === undefined) { state.formPhotoShown = d; updatePhotoPreview(); } }).catch(() => {});
  }
  $('#scan-ok').hidden = !fromScan;
  $('#form-error').hidden = true;
  $('#f-format').closest('details').open = false;
  updateFormPreview();
  if (replace) replaceView('form'); else show('form');
  if (fromScan) setTimeout(() => $('#f-name').focus({ preventScroll: true }), 300);
}

function updateFormPreview() {
  const code = $('#f-code').value.trim();
  const fmt = $('#f-format').value;
  const box = $('#form-preview');
  const warn = $('#form-format-warning');
  warn.hidden = true;
  updateCardPreview();
  if (!code) {
    box.classList.remove('qr');
    box.innerHTML = '<p class="muted small">L\'anteprima del codice comparirà qui</p>';
    return;
  }
  const used = renderBarcode(box, code, fmt, 'small');
  if (!used) {
    box.innerHTML = '<p class="error small">Questo numero non può diventare un codice.</p>';
  } else if (fmt !== 'auto' && used !== fmt) {
    warn.textContent = 'Il numero non è valido per il tipo scelto: verrà usato Code 128.';
    warn.hidden = false;
  }
}

function updatePhotoPreview() {
  const img = $('#f-photo-preview');
  const src = state.formPhoto === undefined ? state.formPhotoShown : state.formPhoto;
  img.hidden = !src;
  if (src) img.src = src; else img.removeAttribute('src');
  $('#f-photo-remove').hidden = !src;
  $('#f-photo-btn').textContent = src ? '📷 Cambia foto' : '📷 Aggiungi foto';
}

async function saveForm(ev) {
  ev.preventDefault();
  const name = $('#f-name').value.trim();
  const code = $('#f-code').value.trim();
  const err = $('#form-error');
  const fail = (msg, el) => { err.textContent = msg; err.hidden = false; vibrate([30, 40, 30]); if (el) el.focus(); };
  if (!name) return fail('Scrivi il nome del negozio.', $('#f-name'));
  if (!code) return fail('Scrivi il numero della carta.', $('#f-code'));

  let format = $('#f-format').value;
  const used = makeBarcodeSvg(code, format, 'large');
  if (!used) return fail('Questo numero non può diventare un codice. Controlla di averlo scritto bene.', $('#f-code'));
  if (format !== 'auto') format = used.fmt;

  const now = Date.now();
  const card = {
    id: state.editing ? state.editing.id : uid(),
    name,
    code,
    format,
    color: currentFormColor(),
    notes: $('#f-notes').value.trim(),
    fav: $('#f-fav').checked,
    hasPhoto: state.editing ? !!state.editing.hasPhoto : false,
    created: state.editing ? state.editing.created : now,
    updated: now,
  };
  try {
    await DB.put(card, state.formPhoto);
  } catch (e) {
    // Un secondo tentativo risolve i casi in cui l'archivio era stato chiuso dal sistema.
    try {
      await new Promise(r => setTimeout(r, 400));
      await DB.put(card, state.formPhoto);
    } catch (e2) {
      const full = e2 && (e2.name === 'QuotaExceededError');
      return fail(full
        ? 'Memoria del telefono piena: libera un po\' di spazio e riprova.'
        : 'Non sono riuscito a salvare. Chiudi del tutto l\'app, riaprila e riprova.');
    }
  }
  const wasEditing = !!state.editing;
  await loadCards();
  vibrate(30);
  toast(wasEditing ? 'Carta aggiornata ✔' : 'Carta salvata ✔');
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
  $('#scan-hint').textContent = 'Tieni il codice a barre dentro il riquadro, ben illuminato.';
  $('#btn-torch').hidden = true;
  $('#btn-torch').textContent = '🔦 Torcia';
  torchOn = false;
  try {
    await Scanner.start($('#scan-video'), onScanned);
    $('#btn-torch').hidden = !Scanner.hasTorch();
    // Dopo un po' senza risultati, un consiglio in più.
    clearTimeout(startCameraScan._hint);
    startCameraScan._hint = setTimeout(() => {
      if ($('#view-scan').classList.contains('active')) {
        $('#scan-hint').textContent = 'Avvicina o allontana un po\' la carta finché il codice è nitido. Evita i riflessi della luce.';
      }
    }, 9000);
  } catch (e) {
    let msg = 'Non riesco ad aprire la fotocamera.';
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      msg = 'Serve il permesso per usare la fotocamera. Consentilo nelle impostazioni del telefono, oppure scrivi il numero a mano.';
    } else if (e && e.message === 'nocamera') {
      msg = 'Qui non si può usare la fotocamera. Usa "Da una foto" oppure scrivi il numero a mano.';
    }
    $('#scan-hint').textContent = msg;
  }
}
function onScanned(r) {
  clearTimeout(startCameraScan._hint);
  vibrate([60, 40, 60]);
  const f = $('#scan-flash');
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  // Se il codice c'è già, lo dice subito.
  const dup = state.cards.find(c => c.code === r.code);
  setTimeout(() => {
    openForm({ code: r.code, format: r.format, fromScan: true, replace: true });
    if (dup) toast(`Attenzione: hai già questo codice nella carta "${dup.name}".`, { ms: 5000 });
  }, 220);
}

async function scanFromPhoto(file) {
  if (!file) return;
  toast('Sto leggendo la foto…', { ms: 15000 });
  try {
    const r = await Scanner.decodeFile(file);
    hideToast();
    if (r && r.code) {
      vibrate([60, 40, 60]);
      let photo = null;
      try { photo = await shrinkPhoto(r.img); } catch (_) {}
      openForm({ code: r.code, format: r.format, fromScan: true, photo });
    } else {
      toast('Non ho trovato un codice nella foto. Prova con una foto più vicina e nitida, oppure scrivi il numero a mano.', { ms: 6000 });
    }
  } catch (e) {
    toast('Non riesco a leggere la foto.', { ms: 4000 });
  }
}

/* =========================================================
 * BACKUP
 * ======================================================= */
function setLastBackup() { try { localStorage.setItem('carteplus.lastBackup', String(Date.now())); } catch (_) {} }
function getLastBackup() { try { return Number(localStorage.getItem('carteplus.lastBackup')) || 0; } catch (_) { return 0; } }

async function exportBackup() {
  const cards = await DB.all();
  if (!cards.length) { toast('Non ci sono carte da salvare.'); return; }
  const photos = await DB.allPhotos();
  const full = cards.map(c => ({ ...c, photo: photos.get(c.id) || null }));
  const data = JSON.stringify({ app: 'carteplus', version: 2, exported: new Date().toISOString(), cards: full });
  const d = new Date();
  const fname = `carte-fedelta-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([data], fname, { type: 'application/json' });
  // Su telefono, il menu Condividi permette di salvarla in File/Drive o mandarla via WhatsApp/email.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia carte fedeltà' }); setLastBackup(); updateSettingsInfo(); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  setLastBackup();
  updateSettingsInfo();
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
      const photo = typeof c.photo === 'string' && c.photo.startsWith('data:image/') ? c.photo : null;
      await DB.put({
        id: typeof c.id === 'string' ? c.id : uid(),
        name: String(c.name).slice(0, 40),
        code: String(c.code),
        format: typeof c.format === 'string' ? c.format : 'auto',
        color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : colorFor(c.name),
        notes: String(c.notes || '').slice(0, 300),
        fav: !!c.fav,
        created: Number(c.created) || Date.now(),
        updated: Number(c.updated) || Date.now(),
      }, photo);
      n++;
    }
    await loadCards();
    renderList();
    updateStorageHint();
    updateSettingsInfo();
    toast(n ? `Recuperate ${n} carte ✔` : 'Nessuna carta trovata nel file.');
  } catch (e) {
    toast('Questo file non è una copia valida di Carte+.', { ms: 4000 });
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
  const last = getLastBackup();
  $('#last-backup').textContent = last
    ? 'Ultima copia: ' + new Date(last).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Non hai ancora fatto nessuna copia.';
  let text = state.cards.length === 1 ? '1 carta salvata.' : `${state.cards.length} carte salvate.`;
  try {
    if (navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()) text += ' Memoria protetta dalla cancellazione automatica.';
  } catch (_) {}
  $('#status-storage').textContent = text;
}

/* =========================================================
 * Avvio
 * ======================================================= */
function bind() {
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));
  $('#btn-add').addEventListener('click', () => { show('add'); Scanner.warmUp(); });
  $('#btn-retry').addEventListener('click', async () => {
    if (!(await refreshCards())) toast('Ancora niente. Chiudi del tutto l\'app e riaprila.', { ms: 6000 });
  });
  $('#btn-settings').addEventListener('click', () => { show('settings'); updateSettingsInfo(); });
  $('#search').addEventListener('input', renderList);

  // Un solo gestore per tutte le carte dell'elenco.
  $('#lists').addEventListener('click', e => {
    const t = e.target.closest('.card-tile');
    if (t) { vibrate(10); openCard(t.dataset.id); }
  });

  $('#btn-scan-camera').addEventListener('click', startCameraScan);
  $('#btn-scan-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', e => { scanFromPhoto(e.target.files[0]); e.target.value = ''; });
  $('#btn-manual').addEventListener('click', () => openForm());

  $('#scan-cancel').addEventListener('click', back);
  $('#scan-to-manual').addEventListener('click', () => { clearTimeout(startCameraScan._hint); openForm({ replace: true }); });
  $('#btn-torch').addEventListener('click', async () => {
    torchOn = !torchOn;
    const ok = await Scanner.torch(torchOn);
    if (!ok) { torchOn = false; toast('Torcia non disponibile.'); }
    $('#btn-torch').textContent = torchOn ? '🔦 Spegni torcia' : '🔦 Torcia';
  });

  $('#card-form').addEventListener('submit', saveForm);
  $('#f-name').addEventListener('input', onNameInput);
  $('#f-code').addEventListener('input', () => { updateFormPreview(); $('#form-error').hidden = true; });
  $('#f-format').addEventListener('change', updateFormPreview);
  $('#f-photo-btn').addEventListener('click', () => $('#f-photo-input').click());
  $('#f-photo-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { state.formPhoto = await shrinkPhoto(f); updatePhotoPreview(); } catch (_) { toast('Foto non leggibile.'); }
  });
  $('#f-photo-remove').addEventListener('click', () => { state.formPhoto = null; updatePhotoPreview(); });

  $('#btn-fav').addEventListener('click', toggleFav);
  $('#btn-zoom').addEventListener('click', openZoom);
  $('#show-barcode-btn').addEventListener('click', openZoom);
  $('#zoom').addEventListener('click', closeZoom);
  $('#btn-copy').addEventListener('click', copyCode);
  $('#btn-edit').addEventListener('click', () => openForm({ card: state.current }));
  $('#btn-delete').addEventListener('click', async () => {
    const c = state.current;
    if (!c) return;
    if (!(await confirmDialog(`Eliminare la carta "${c.name}"?`))) return;
    const photo = c.hasPhoto ? await DB.photo(c.id).catch(() => null) : null;
    await DB.remove(c.id);
    await loadCards();
    goHome();
    toast('Carta eliminata', {
      ms: 6000,
      action: 'Annulla',
      onAction: async () => {
        await DB.put(c, photo);
        await loadCards();
        renderList();
        toast('Carta ripristinata ✔');
      },
    });
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

/* Su iPhone, Safari e l'app sulla schermata Home hanno archivi SEPARATI:
   le carte salvate in uno non compaiono nell'altro. Lo spieghiamo chiaramente. */
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function updateStorageHint() {
  const box = $('#storage-hint');
  if (!box) return;
  let html = '';
  if (isIOS() && !isStandalone()) {
    html = '<strong>Importante:</strong> stai usando Carte+ dentro Safari. Le carte salvate qui <strong>non compaiono</strong> nell\'app sulla schermata Home (e viceversa). Scegli un solo modo e usa sempre quello. Per spostare le carte: Impostazioni → <em>Salva copia</em>, poi nell\'altra <em>Recupera da copia</em>.';
  } else if (isIOS() && isStandalone() && state.cards.length === 0) {
    html = '<strong>Avevi già salvato delle carte aprendo il sito in Safari?</strong> Sono ancora lì: apri l\'indirizzo in Safari, vai in Impostazioni → <em>Salva copia</em>, poi qui tocca ⚙️ → <em>Recupera da copia</em>.';
  }
  box.innerHTML = html;
  box.hidden = !html;
}

async function refreshCards() {
  const errBox = $('#load-error');
  try {
    await loadCards();
    if (errBox) errBox.hidden = true;
    renderList();
    return true;
  } catch (e) {
    // Non mostrare "nessuna carta": le carte ci sono, solo non si riescono a leggere ora.
    renderList();
    $('#empty').hidden = true;
    if (errBox) errBox.hidden = false;
    return false;
  }
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  // Quando arriva una versione nuova, la carica subito se si è nella schermata principale.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    if (state.stack.length === 1 && $('#zoom').hidden) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => { if (navigator.onLine) reg.update().catch(() => {}); })
    .catch(() => {});
}

/* Se il telefono ha tenuto file di versioni diverse, li butta e ricarica
   (una sola volta per sessione, e solo con internet). */
function repairOnce() {
  if (window.carteRepair) return window.carteRepair();
  try { if (sessionStorage.getItem('carte-repair')) return false; sessionStorage.setItem('carte-repair', '1'); } catch (_) { return false; }
  if (!navigator.onLine) return false;
  const go = () => location.reload();
  Promise.all([
    window.caches ? caches.keys().then(k => Promise.all(k.map(x => caches.delete(x)))) : null,
    navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => Promise.all(r.map(x => x.update().catch(() => {})))) : null,
  ]).then(go, go);
  return true;
}

async function init() {
  const mismatch = document.documentElement.dataset.version !== APP_VERSION;
  if (mismatch && repairOnce()) return;
  buildColorSwatches();
  bind();
  await refreshCards();
  updateStorageHint();
  // Avvio riuscito: se servirà, la riparazione automatica potrà ripartire.
  if (!mismatch) setTimeout(() => { try { sessionStorage.removeItem('carte-repair'); } catch (_) {} }, 3000);

  // Chiede al browser di non cancellare mai i dati.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}

  setupServiceWorker();
}

init().catch(err => {
  // Se qualcosa va storto all'avvio, prova a sistemare da sola (una volta).
  console.error(err);
  if (!repairOnce()) {
    toast('Qualcosa non va. Chiudi e riapri l\'app.', { ms: 8000 });
  }
});
