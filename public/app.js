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
const btnLang    = document.getElementById('btn-lang');
const btnRefresh = document.getElementById('btn-refresh');
const dropZone   = document.getElementById('drop-zone');
const fileInput  = document.getElementById('file-input');

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
let aesMasterKeyStr    = null; // "NO-CRYPTO" if not supported
let isSender           = false;
let sessionFiles       = [];

// ─── LOCALIZATION (FR/EN) ───
const i18n = {
    EN: {
        send_title: "Send Files", send_desc: "Share with devices on this Wi-Fi",
        recv_title: "Receive Files", recv_desc: "Enter a code",
        your_pin: "YOUR PIN CODE", scan_to_connect: "SCAN TO CONNECT",
        drop_title: "Drop files here", drop_desc: "or click to browse",
        connect_title: "Connect to Sender", connect_desc: "Enter the sender's IP address and the PIN shown on their screen",
        sender_ip: "SENDER'S IP ADDRESS", digit_pin: "6-DIGIT PIN CODE",
        connect_btn: "Connect", connected_status: "Connected to Session",
        cancel_back: "← Cancel & Back", history_title: "Transfer History"
    },
    FR: {
        send_title: "Envoyer Fichiers", send_desc: "Partager sur ce Wi-Fi",
        recv_title: "Recevoir Fichiers", recv_desc: "Saisir le code",
        your_pin: "VOTRE CODE PIN", scan_to_connect: "SCANNEZ POUR REJOINDRE",
        drop_title: "Déposez vos fichiers", drop_desc: "ou cliquez pour parcourir",
        connect_title: "Se connecter", connect_desc: "Entrez l'IP de l'expéditeur et son code PIN",
        sender_ip: "ADRESSE IP EXPÉDITEUR", digit_pin: "CODE PIN À 6 CHIFFRES",
        connect_btn: "Connexion", connected_status: "Connecté à la session",
        cancel_back: "← Retour", history_title: "Historique"
    }
};

let currentLang = localStorage.getItem('lang') || 'EN';
document.getElementById('lang-text').innerText = currentLang;

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.getElementById('lang-text').innerText = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[lang][key]) el.textContent = i18n[lang][key];
    });
}
setLanguage(currentLang);

btnLang.addEventListener('click', () => setLanguage(currentLang === 'EN' ? 'FR' : 'EN'));

// ─── REFRESH APP ───
if(btnRefresh) {
    btnRefresh.addEventListener('click', () => {
        window.location.reload();
    });
}

// ─── CRYPTO ───
const Crypto = {
    isSupported: () => !!(window.crypto && window.crypto.subtle),

    generateAESKey: async () => {
        if (!Crypto.isSupported()) return { key: null, exported: new Uint8Array([0]) };
        const key = await crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
        const raw = await crypto.subtle.exportKey('raw', key);
        return { key, exported: new Uint8Array(raw) };
    },
    importAESKey: (rawBytes) => {
        if (!Crypto.isSupported()) return null;
        return crypto.subtle.importKey('raw', rawBytes, 'AES-GCM', true, ['encrypt','decrypt']);
    },

    encrypt: async (key, buf) => {
        if (!key) return buf; // fallback plain
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, buf);
        const out = new Uint8Array(12 + ct.byteLength);
        out.set(iv); out.set(new Uint8Array(ct), 12);
        return out.buffer;
    },
    decrypt: async (key, buf) => {
        if (!key) return buf; // fallback plain
        const b = new Uint8Array(buf);
        return crypto.subtle.decrypt({ name:'AES-GCM', iv:b.slice(0,12) }, key, b.slice(12));
    },
    generateECDH: () => {
        if (!Crypto.isSupported()) return Promise.resolve(null);
        return crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']);
    },

    exportPubKey: async (key) => {
        if (!key) return "no-pub";
        const exp = await crypto.subtle.exportKey('spki', key);
        return btoa(String.fromCharCode(...new Uint8Array(exp)));
    },
    importPubKey: (b64) => {
        if (b64 === "no-pub") return null;
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return crypto.subtle.importKey('spki', bytes, { name:'ECDH', namedCurve:'P-256'}, true, []);
    },
    deriveAES: (priv, pub) => {
        if (!priv || !pub) return Promise.resolve(null);
        return crypto.subtle.deriveKey({ name:'ECDH', public:pub }, priv, { name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
    },

    toHex: (buf) => Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''),
    fromHex: (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(b=>parseInt(b,16)))
};



// ─── SOCKET MANAGEMENT ───
function setupSocketListeners(sock) {
    sock.on('files-updated', (files) => {
        sessionFiles = files;
        renderFileList();
    });
    sock.on('signal', handleSignal);
    
    // When a receiver joins, update the sender's UI to indicate connection
    sock.on('peer-joined', () => {
        if (isSender) {
            document.querySelector('.session-info').style.display = 'none';
            document.querySelector('#drop-zone h3').textContent = currentLang === 'EN' ? 'Peer connected! Drop files' : 'Appareil connecté! Déposez vos fichiers';
            document.getElementById('drop-zone').classList.add('active-peer');
        }
    });
}

let API_BASE = window.location.origin;

function connectToServer(serverIP) {
    return new Promise((resolve, reject) => {
        if (socket) { socket.off(); socket.disconnect(); socket = null; }

        API_BASE = serverIP ? `http://${serverIP}:3000` : window.location.origin;
        const s = io(API_BASE, { timeout: 5000, reconnection: false });

        s.on('connect', () => { socket = s; setupSocketListeners(s); resolve(s); });
        s.on('connect_error', (err) => reject(err));
        // Timeout fallback
        setTimeout(() => reject(new Error('Connection timeout')), 6000);
    });
}

// ─── ECDH SIGNAL HANDLER ───
async function handleSignal(data) {
    try {
        if (!isSender && data.type === 'ecdh-offer') {
            if (data.encMasterKey === 'NO-CRYPTO' || !Crypto.isSupported()) {
                aesMasterKeyStr = 'NO-CRYPTO';
                socket.emit('signal', { code: currentSessionCode, type: 'ecdh-answer', pubKey: "no-pub" });
                return;
            }
            const senderPub = await Crypto.importPubKey(data.pubKey);
            const myECDH = await Crypto.generateECDH();
            const shared = await Crypto.deriveAES(myECDH.privateKey, senderPub);
            const encBytes = Crypto.fromHex(data.encMasterKey);
            const masterRaw = await Crypto.decrypt(shared, encBytes.buffer);
            aesMasterKeyStr = Crypto.toHex(masterRaw);
            socket.emit('signal', { code: currentSessionCode, type: 'ecdh-answer',
                pubKey: await Crypto.exportPubKey(myECDH.publicKey) });

        } else if (isSender && data.type === 'request-key') {
            if (aesMasterKeyStr === 'NO-CRYPTO' || data.pubKey === "no-pub" || !Crypto.isSupported()) {
                aesMasterKeyStr = 'NO-CRYPTO';
                socket.emit('signal', { code: currentSessionCode, type: 'ecdh-offer',
                    pubKey: "no-pub", encMasterKey: "NO-CRYPTO" });
                return;
            }
            const senderECDH = await Crypto.generateECDH();
            const receiverPub = await Crypto.importPubKey(data.pubKey);
            const shared = await Crypto.deriveAES(senderECDH.privateKey, receiverPub);
            const masterBytes = Crypto.fromHex(aesMasterKeyStr);
            const encBuf = await Crypto.encrypt(shared, masterBytes.buffer);
            socket.emit('signal', { code: currentSessionCode, type: 'ecdh-offer',
                pubKey: await Crypto.exportPubKey(senderECDH.publicKey),
                encMasterKey: Crypto.toHex(encBuf) });
        }
    } catch(err) {
        console.warn("Crypto signaling failed (using fallback):", err);
        aesMasterKeyStr = 'NO-CRYPTO';
        if (!isSender) socket.emit('signal', { code: currentSessionCode, type: 'ecdh-answer', pubKey: "no-pub" });
        else socket.emit('signal', { code: currentSessionCode, type: 'ecdh-offer', pubKey: "no-pub", encMasterKey: "NO-CRYPTO" });
    }
}

// ─── INIT ───
async function init() {
    // Initial connection to own server (sender mode)
    socket = io(window.location.origin);
    setupSocketListeners(socket);

    // Hash deep-link handling
    if (window.location.hash) {
        const p = new URLSearchParams(window.location.hash.slice(1));

        // Mobile app auto-mode: navigate directly to Send or Receive
        const automode = p.get('automode');
        if (automode === 'send') {
            // Clear the hash so it doesn't re-trigger on refresh
            history.replaceState(null, '', window.location.pathname);
            // Auto-click Send
            setTimeout(() => btnSend.click(), 300);
            return;
        }
        if (automode === 'receive') {
            history.replaceState(null, '', window.location.pathname);
            // Show receive screen directly
            ui.showScreen('screen-receive');
            return;
        }

        // Legacy QR hash deep-link
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
        aesMasterKeyStr = Crypto.isSupported() ? Crypto.toHex(exported) : 'NO-CRYPTO';

        document.getElementById('my-session-code').innerText = currentSessionCode;
        document.getElementById('sender-ip-display').textContent = `IP: ${data.localIp}  •  Port: ${data.port}`;
        socket.emit('join-session', currentSessionCode);
        ui.showScreen('screen-send');
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
    const form = document.getElementById('receive-form');
    const list = document.getElementById('receiver-file-list');
    if (form) form.classList.add('hidden');
    if (list) list.classList.remove('hidden');

    socket.emit('join-session', code);

    if (!aesMasterKeyStr) {
        if (!Crypto.isSupported()) {
            socket.emit('signal', { code, type: 'request-key', pubKey: "no-pub" });
        } else {
            Crypto.generateECDH().then(async ecdh => {
                const pub = await Crypto.exportPubKey(ecdh.publicKey);
                socket.emit('signal', { code, type: 'request-key', pubKey: pub });
            }).catch(e => {
                console.warn("ECDH failed:", e);
                socket.emit('signal', { code, type: 'request-key', pubKey: "no-pub" });
            });
        }
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

// Fix infinite click loop: simply let the input handle clicks
dropZone.addEventListener('click', (e) => {
    // Only programmatically click if the user didn't natively click the input
    if (e.target !== fileInput) {
        fileInput.click();
    }
});

fileInput.addEventListener('change', function() { 
    if (this.files.length) {
        const filesArray = Array.from(this.files); // Clone array before clearing native FileList
        handleFiles(filesArray); 
    }
    this.value = ''; 
});

async function handleFiles(files) {
    if (!currentSessionCode || !aesMasterKeyStr) { alert('No active session.'); return; }
    document.getElementById('sender-file-list').classList.remove('hidden');

    const aesKey = (aesMasterKeyStr !== 'NO-CRYPTO' && Crypto.isSupported()) 
        ? await Crypto.importAESKey(Crypto.fromHex(aesMasterKeyStr)) 
        : null;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const id = `up-${Date.now()}-${i}`;
        addFileToList('sender-file-list', id, file.name, file.size, '<span style="color:var(--text-muted)">Sending…</span>');

        try {
            const form = new FormData();
            form.append('code', currentSessionCode);
            
            if (aesKey) {
                // E2E Encrypted upload
                const buf = await file.arrayBuffer();
                const enc = await Crypto.encrypt(aesKey, buf);
                form.append('files', new Blob([enc]), file.name);
            } else {
                // High-speed direct streaming (native browser upload)
                form.append('files', file, file.name);
            }

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
    if (!aesMasterKeyStr) { alert('Connexion sécurité en cours, veuillez réessayer dans un instant.'); return; }
    const btn = document.querySelector(`#dl-${fileId} button`);
    
    // If NO encryption is used, we can just trigger native high-speed browser download
    if (aesMasterKeyStr === 'NO-CRYPTO' || !Crypto.isSupported()) {
        const a = Object.assign(document.createElement('a'), { 
            href: `${API_BASE}/api/download/${currentSessionCode}/${fileId}`, 
            download: fileName 
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        if (btn) btn.textContent = '✓ Done';
        saveHistory(fileName, fileSize, 'Received');
        return;
    }

    // E2E Encrypted download
    if (btn) btn.textContent = 'Downloading…';
    try {
        const res = await fetch(`${API_BASE}/api/download/${currentSessionCode}/${fileId}`);
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
