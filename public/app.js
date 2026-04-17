/* =============================================
   LocalShare — app.js (v2)
   Fixed: connect button, QR scanner, dark mode
   ============================================= */

// ─── UI HELPERS ───
const ui = {
    showScreen: (id) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('view-active'));
        document.getElementById(id).classList.add('view-active');
    }
};

// ─── DOM ELEMENTS ───
const btnSend    = document.getElementById('btn-choice-send');
const btnReceive = document.getElementById('btn-choice-receive');
const btnConnect = document.getElementById('btn-connect');
const btnHistory = document.getElementById('btn-history');
const btnTheme   = document.getElementById('btn-theme');
const btnScanQR  = document.getElementById('btn-scan-qr');
const btnCloseScanner = document.getElementById('btn-close-scanner');
const dropZone   = document.getElementById('drop-zone');
const fileInput  = document.getElementById('file-input');
const qrModal    = document.getElementById('qr-modal');
const qrVideo    = document.getElementById('qr-video');

// ─── DARK MODE ───
(function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
})();

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const sunIcon  = document.getElementById('icon-sun');
    const moonIcon = document.getElementById('icon-moon');
    if (sunIcon)  sunIcon.style.display  = theme === 'dark' ? 'none'  : 'block';
    if (moonIcon) moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
}

btnTheme.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

// ─── STATE ───
let socket = null;
let currentSessionCode = null;
let aesMasterKeyStr    = null;
let isSender           = false;
let sessionFiles       = [];
let scannerStream      = null;
let scannerInterval    = null;

// ─── CRYPTO ───
const Crypto = {
    generateAESKey: async () => {
        const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
        const raw = await crypto.subtle.exportKey('raw', key);
        return { key, exported: new Uint8Array(raw) };
    },
    importAESKey: (rawBytes) =>
        crypto.subtle.importKey('raw', rawBytes, 'AES-GCM', true, ['encrypt','decrypt']),

    encrypt: async (key, buf) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, buf);
        const out = new Uint8Array(12 + ct.byteLength);
        out.set(iv); out.set(new Uint8Array(ct), 12);
        return out.buffer;
    },
    decrypt: async (key, buf) => {
        const b = new Uint8Array(buf);
        return crypto.subtle.decrypt({ name:'AES-GCM', iv:b.slice(0,12) }, key, b.slice(12));
    },
    generateECDH: () =>
        crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']),

    exportPubKey: async (key) => {
        const exp = await crypto.subtle.exportKey('spki', key);
        return btoa(String.fromCharCode(...new Uint8Array(exp)));
    },
    importPubKey: (b64) => {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return crypto.subtle.importKey('spki', bytes, { name:'ECDH', namedCurve:'P-256'}, true, []);
    },
    deriveAES: (priv, pub) =>
        crypto.subtle.deriveKey({ name:'ECDH', public:pub }, priv, { name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']),

    toHex: (buf) => Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''),
    fromHex: (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b=>parseInt(b,16)))
};

// ─── QR RENDERING ───
// qrcode.min.js is loaded via <script> in HTML — no dynamic loading needed
function drawQR(canvas, text) {
    const placeholder = document.getElementById('qr-placeholder');
    if (typeof qrcode === 'undefined') {
        // Fallback: hide loader, show nothing
        if (placeholder) placeholder.style.display = 'none';
        return;
    }
    try {
        if (placeholder) placeholder.style.display = 'none';
        canvas.style.display = 'block';
        const qr = qrcode(0, 'L');
        qr.addData(text);
        qr.make();
        const ctx = canvas.getContext('2d');
        const sz = canvas.width;
        const mc = qr.getModuleCount();
        const ms = Math.floor(sz / mc);
        const off = Math.floor((sz - mc * ms) / 2);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, sz, sz);
        ctx.fillStyle = '#000';
        for (let r = 0; r < mc; r++)
            for (let c = 0; c < mc; c++)
                if (qr.isDark(r, c))
                    ctx.fillRect(off + c*ms, off + r*ms, ms, ms);
    } catch(e) { console.warn('QR render failed', e); }
}

// ─── SOCKET MANAGEMENT ───
function setupSocketListeners(sock) {
    sock.on('files-updated', (files) => {
        sessionFiles = files;
        renderFileList();
    });
    sock.on('signal', handleSignal);
}

function connectToServer(serverIP) {
    return new Promise((resolve, reject) => {
        if (socket) { socket.off(); socket.disconnect(); socket = null; }

        const url = serverIP ? `http://${serverIP}:3000` : window.location.origin;
        const s = io(url, { timeout: 5000, reconnection: false });

        s.on('connect', () => { socket = s; setupSocketListeners(s); resolve(s); });
        s.on('connect_error', (err) => reject(err));
        // Timeout fallback
        setTimeout(() => reject(new Error('Connection timeout')), 6000);
    });
}

// ─── ECDH SIGNAL HANDLER ───
async function handleSignal(data) {
    if (!isSender && data.type === 'ecdh-offer') {
        const senderPub = await Crypto.importPubKey(data.pubKey);
        const myECDH = await Crypto.generateECDH();
        const shared = await Crypto.deriveAES(myECDH.privateKey, senderPub);
        const encBytes = Crypto.fromHex(data.encMasterKey);
        const masterRaw = await Crypto.decrypt(shared, encBytes.buffer);
        aesMasterKeyStr = Crypto.toHex(masterRaw);
        socket.emit('signal', { code: currentSessionCode, type: 'ecdh-answer',
            pubKey: await Crypto.exportPubKey(myECDH.publicKey) });

    } else if (isSender && data.type === 'request-key') {
        const senderECDH = await Crypto.generateECDH();
        const receiverPub = await Crypto.importPubKey(data.pubKey);
        const shared = await Crypto.deriveAES(senderECDH.privateKey, receiverPub);
        const masterBytes = Crypto.fromHex(aesMasterKeyStr);
        const encBuf = await Crypto.encrypt(shared, masterBytes.buffer);
        socket.emit('signal', { code: currentSessionCode, type: 'ecdh-offer',
            pubKey: await Crypto.exportPubKey(senderECDH.publicKey),
            encMasterKey: Crypto.toHex(encBuf) });
    }
}

// ─── INIT ───
async function init() {
    // Initial connection to own server (sender mode)
    socket = io(window.location.origin);
    setupSocketListeners(socket);

    // QR hash deep-link (phone scanning the QR code in browser)
    if (window.location.hash) {
        const p = new URLSearchParams(window.location.hash.slice(1));
        const session = p.get('session'), key = p.get('key'), ip = p.get('ip');
        if (session && key && ip) {
            isSender = false;
            currentSessionCode = session;
            aesMasterKeyStr = key;
            if (ip !== window.location.hostname) {
                socket.off(); socket.disconnect();
                socket = io(`http://${ip}:3000`);
                setupSocketListeners(socket);
            }
            ui.showScreen('screen-receive');
            setTimeout(() => finishJoin(session), 600);
        }
    }
}

// ─── SENDER ───
btnSend.addEventListener('click', async () => {
    isSender = true;
    btnSend.disabled = true;
    btnSend.querySelector('h2').textContent = 'Loading…';
    try {
        const res  = await fetch('/api/session');
        const data = await res.json();
        currentSessionCode = data.code;

        const { exported } = await Crypto.generateAESKey();
        aesMasterKeyStr = Crypto.toHex(exported);

        document.getElementById('my-session-code').innerText = currentSessionCode;
        document.getElementById('sender-ip-display').textContent = `IP: ${data.localIp}  •  Port: ${data.port}`;
        socket.emit('join-session', currentSessionCode);
        ui.showScreen('screen-send');

        const url = `http://${data.localIp}:${data.port}/#session=${currentSessionCode}&key=${aesMasterKeyStr}&ip=${data.localIp}`;
        document.getElementById('qr-placeholder').style.display = 'none';
        const canvas = document.getElementById('qr-canvas');
        canvas.style.display = 'block';
        drawQR(canvas, url);
    } catch(e) {
        alert('Failed to create session: ' + e.message);
        btnSend.querySelector('h2').textContent = 'Send Files';
    } finally {
        btnSend.disabled = false;
        btnSend.querySelector('h2').textContent = 'Send Files';
    }
});

// ─── RECEIVER ───
btnReceive.addEventListener('click', () => { isSender = false; ui.showScreen('screen-receive'); });

btnConnect.addEventListener('click', async () => {
    const code = document.getElementById('pin-input').value.trim();
    const ip   = document.getElementById('ip-input').value.trim();
    clearStatus();

    if (code.length !== 6) { showStatus('⚠️ Enter the 6-digit PIN shown on the sender\'s screen.', 'error'); return; }
    if (!ip)               { showStatus('⚠️ Enter the sender\'s IP address shown under their PIN.', 'error'); return; }

    setConnectLoading(true);
    currentSessionCode = code;
    isSender = false;

    try {
        await connectToServer(ip);
        showStatus('✓ Connected! Waiting for files…', 'success');
        setTimeout(() => finishJoin(code), 300);
    } catch(e) {
        setConnectLoading(false);
        showStatus(`⚠️ Cannot reach sender at ${ip}. Make sure:\n• Both devices are on the same Wi-Fi\n• The IP address is correct`, 'error');
    }
});

function setConnectLoading(loading) {
    btnConnect.disabled = loading;
    btnConnect.textContent = loading ? 'Connecting…' : 'Connect';
}

function finishJoin(code) {
    document.getElementById('receive-form').classList.add('hidden');
    document.getElementById('receiver-file-list').classList.remove('hidden');
    socket.emit('join-session', code);

    if (!aesMasterKeyStr) {
        Crypto.generateECDH().then(async ecdh => {
            const pub = await Crypto.exportPubKey(ecdh.publicKey);
            socket.emit('signal', { code, type: 'request-key', pubKey: pub });
        });
    }
}

function disconnectAndGoBack() {
    if (socket && currentSessionCode) socket.emit('leave-session', currentSessionCode);
    currentSessionCode = null; aesMasterKeyStr = null; isSender = false;
    document.getElementById('receive-form').classList.remove('hidden');
    document.getElementById('receiver-file-list').classList.add('hidden');
    document.getElementById('pin-input').value = '';
    document.getElementById('ip-input').value  = '';
    clearStatus(); setConnectLoading(false);
    // Reconnect to own server
    if (socket) { socket.off(); socket.disconnect(); }
    socket = io(window.location.origin);
    setupSocketListeners(socket);
    ui.showScreen('screen-choice');
}

// ─── STATUS MESSAGES ───
function showStatus(msg, type) {
    let el = document.getElementById('status-msg');
    if (!el) {
        el = document.createElement('p');
        el.id = 'status-msg';
        document.getElementById('receive-form').appendChild(el);
    }
    el.textContent = msg;
    el.style.cssText = `
        font-size:13px; line-height:1.6; margin-top:12px; padding:12px;
        border-radius:10px; white-space:pre-line;
        color:${type==='error'?'#FF3B30':'#34C759'};
        background:${type==='error'?'rgba(255,59,48,0.08)':'rgba(52,199,89,0.08)'};
        border:1px solid ${type==='error'?'rgba(255,59,48,0.2)':'rgba(52,199,89,0.2)'};
    `;
}
function clearStatus() {
    const el = document.getElementById('status-msg');
    if (el) el.remove();
}

// ─── QR SCANNER (in-app camera) ───
btnScanQR.addEventListener('click', openScanner);
btnCloseScanner.addEventListener('click', closeScanner);

async function openScanner() {
    qrModal.classList.remove('hidden');
    try {
        scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width:{ideal:1280}, height:{ideal:720} }
        });
        qrVideo.srcObject = scannerStream;
        qrVideo.play();
        startScanLoop();
    } catch(err) {
        closeScanner();
        if (err.name === 'NotAllowedError') {
            alert('📷 Camera permission denied.\n\nPlease allow camera access:\nSettings > App > LocalShare > Camera → Allow');
        } else {
            alert('Cannot access camera: ' + err.message);
        }
    }
}

function closeScanner() {
    clearInterval(scannerInterval); scannerInterval = null;
    if (scannerStream) { scannerStream.getTracks().forEach(t=>t.stop()); scannerStream=null; }
    qrVideo.srcObject = null;
    qrModal.classList.add('hidden');
}

function startScanLoop() {
    if (!('BarcodeDetector' in window)) {
        document.querySelector('.scanner-hint').textContent =
            '⚠️ Scan automatique non supporté. Tapez manuellement l\'IP et le PIN.';
        return;
    }
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d');

    scannerInterval = setInterval(async () => {
        if (qrVideo.readyState < 2 || qrVideo.videoWidth === 0) return;
        offscreen.width = qrVideo.videoWidth;
        offscreen.height = qrVideo.videoHeight;
        ctx.drawImage(qrVideo, 0, 0);
        try {
            const codes = await detector.detect(offscreen);
            if (codes.length > 0) handleQRResult(codes[0].rawValue);
        } catch{}
    }, 250);
}

function handleQRResult(raw) {
    closeScanner();
    try {
        const url = new URL(raw);
        const hash = new URLSearchParams(url.hash.slice(1));
        const session = hash.get('session'), key = hash.get('key'), ip = hash.get('ip') || url.hostname;

        if (!session || !key || !ip) throw new Error('Missing params');

        isSender = false;
        currentSessionCode = session;
        aesMasterKeyStr = key;
        document.getElementById('ip-input').value = ip;
        document.getElementById('pin-input').value = session;
        ui.showScreen('screen-receive');
        showStatus('QR Code scanné ! Connexion en cours…', 'success');

        // Connect to sender's server
        connectToServer(ip).then(() => {
            setTimeout(() => finishJoin(session), 300);
        }).catch(err => {
            showStatus(`⚠️ Impossible de rejoindre le sender à ${ip}.`, 'error');
        });
    } catch(e) {
        alert('QR invalide. Scannez le QR affiché dans LocalShare.\nErreur: ' + e.message);
    }
}

// ─── FILE UPLOAD (Sender) ───
['dragenter','dragover','dragleave','drop'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })
);
['dragenter','dragover'].forEach(ev =>
    dropZone.addEventListener(ev, () => dropZone.classList.add('active'))
);
['dragleave','drop'].forEach(ev =>
    dropZone.addEventListener(ev, () => dropZone.classList.remove('active'))
);

dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

// Fix infinite click loop: only trigger if the click didn't come from the input itself
dropZone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
});

fileInput.addEventListener('change', function() { handleFiles(this.files); this.value=''; });
fileInput.addEventListener('click', e => e.stopPropagation()); // Prevent bubbling to dropzone

async function handleFiles(files) {
    if (!currentSessionCode || !aesMasterKeyStr) { alert('No active session.'); return; }
    document.getElementById('sender-file-list').classList.remove('hidden');

    const keyBytes = Crypto.fromHex(aesMasterKeyStr);
    const aesKey   = await Crypto.importAESKey(keyBytes);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const id = `up-${Date.now()}-${i}`;
        addFileToList('sender-file-list', id, file.name, file.size, '<span style="color:var(--text-muted)">Encrypting…</span>');

        try {
            const buf   = await file.arrayBuffer();
            const enc   = await Crypto.encrypt(aesKey, buf);
            const form  = new FormData();
            form.append('code', currentSessionCode);
            form.append('files', new Blob([enc]), file.name);
            await fetch('/api/upload', { method:'POST', body:form });
            setFileStatus(id, '<span style="color:var(--success)">✓ Sent</span>');
            saveHistory(file.name, file.size, 'Sent');
        } catch(e) {
            console.error(e);
            setFileStatus(id, '<span style="color:var(--danger)">✗ Error</span>');
        }
    }
}

// ─── FILE DOWNLOAD (Receiver) ───
function renderFileList() {
    if (isSender) return;
    const list = document.getElementById('receiver-file-list');
    list.innerHTML = `<div class="connection-status"><span class="status-dot online"></span> Connected · ${sessionFiles.length} file(s) ready</div>`;
    sessionFiles.forEach(f => {
        addFileToList('receiver-file-list', `dl-${f.id}`, f.name, f.size,
            `<button onclick="downloadFile('${f.id}','${f.name}',${f.size})">Download</button>`);
    });
}

async function downloadFile(fileId, fileName, fileSize) {
    if (!aesMasterKeyStr) { alert('Security key not received yet.'); return; }
    const btn = document.querySelector(`#dl-${fileId} button`);
    if (btn) btn.textContent = 'Downloading…';
    try {
        const res = await fetch(`/api/download/${currentSessionCode}/${fileId}`);
        const enc = await (await res.blob()).arrayBuffer();
        const key = await Crypto.importAESKey(Crypto.fromHex(aesMasterKeyStr));
        const dec = await Crypto.decrypt(key, enc);
        const url = URL.createObjectURL(new Blob([dec]));
        const a = Object.assign(document.createElement('a'), { href:url, download:fileName });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (btn) btn.textContent = '✓ Done';
        saveHistory(fileName, fileSize, 'Received');
    } catch(e) {
        console.error(e);
        if (btn) btn.textContent = '✗ Failed';
    }
}

// ─── HELPERS ───
function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1048576).toFixed(1) + ' MB';
}

function addFileToList(listId, id, name, size, actionHTML) {
    const div = Object.assign(document.createElement('div'), { id, className:'file-item' });
    div.innerHTML = `<div class="file-info"><span class="file-name">${name}</span><span class="file-meta">${fmtSize(size)}</span></div><div class="file-action">${actionHTML}</div>`;
    document.getElementById(listId).appendChild(div);
}

function setFileStatus(id, html) {
    const el = document.querySelector(`#${id} .file-action`);
    if (el) el.innerHTML = html;
}

// ─── HISTORY ───
function saveHistory(name, size, type) {
    const h = JSON.parse(localStorage.getItem('ls_history') || '[]');
    h.unshift({ name, size, type, date: new Date().toLocaleString() });
    localStorage.setItem('ls_history', JSON.stringify(h.slice(0,50)));
}

btnHistory.addEventListener('click', () => {
    ui.showScreen('screen-history');
    const h = JSON.parse(localStorage.getItem('ls_history') || '[]');
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    if (!h.length) {
        list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px 0;font-size:14px">No transfers yet</p>';
        return;
    }
    h.forEach((item, i) => addFileToList('history-list', `hist-${i}`, item.name, item.size,
        `<span style="font-size:12px;font-weight:600;color:${item.type==='Sent'?'var(--accent-primary)':'var(--success)'}">${item.type}</span>`
    ));
});

// ─── BOOT ───
init();
