const socket = io();

// Screens
const choiceScreen = document.getElementById('choice-screen');
const sendScreen = document.getElementById('send-screen');
const receiveScreen = document.getElementById('receive-screen');

// Global state
let currentCode = null;

// Initialization
document.getElementById('btn-send').onclick = initSendMode;
document.getElementById('btn-receive').onclick = initReceiveMode;
document.getElementById('back-to-menu-send').onclick = resetToMenu;
document.getElementById('back-to-menu-receive').onclick = resetToMenu;

// --- SENDER MODE ---
async function initSendMode() {
    choiceScreen.classList.add('hidden');
    sendScreen.classList.remove('hidden');
    
    // Get new code from server
    const res = await fetch('/api/session');
    const data = await res.json();
    currentCode = data.code;
    document.getElementById('session-code').textContent = currentCode;
    
    // Join room to see updates if any
    socket.emit('join-session', currentCode);
}

// File Input / Drag & Drop
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');

dropZone.onclick = () => fileInput.click();
fileInput.onchange = () => handleFiles(fileInput.files);

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drop-zone--over'); };
dropZone.ondragleave = () => dropZone.classList.remove('drop-zone--over');
dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--over');
    handleFiles(e.dataTransfer.files);
};

async function handleFiles(files) {
    if (!files.length) return;
    
    const formData = new FormData();
    formData.append('code', currentCode);
    for (let file of files) {
        formData.append('files', file);
    }

    // Show Progress
    const status = document.getElementById('upload-status');
    const bar = document.getElementById('status-bar');
    const percent = document.getElementById('status-percent');
    status.classList.remove('hidden');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const p = Math.round((e.loaded / e.total) * 100);
            bar.style.width = p + '%';
            percent.textContent = p + '%';
        }
    };

    xhr.onload = () => {
        if (xhr.status === 200) {
            document.getElementById('status-text').textContent = 'Upload Complete!';
            setTimeout(() => status.classList.add('hidden'), 2000);
        } else {
            alert('Upload failed');
        }
    };

    xhr.send(formData);
}

// --- RECEIVER MODE ---
function initReceiveMode() {
    choiceScreen.classList.add('hidden');
    receiveScreen.classList.remove('hidden');
}

document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('input-code').value.trim();
    if (code.length !== 6) return alert('Enter 6-digit code');
    
    currentCode = code;
    socket.emit('join-session', code);
    document.getElementById('code-entry').classList.add('hidden');
    document.getElementById('file-list-container').classList.remove('hidden');
};

// --- SHARED UPDATES ---
socket.on('files-updated', (files) => {
    const list = document.getElementById('file-list');
    const sentList = document.getElementById('sent-files');
    
    const html = files.map(file => `
        <div class="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="p-2 bg-blue-50 rounded-xl text-blue-500">
                    ${getFileIcon(file.type)}
                </div>
                <div class="overflow-hidden">
                    <p class="text-sm font-semibold text-gray-800 truncate">${file.name}</p>
                    <p class="text-xs text-gray-400">${formatSize(file.size)}</p>
                </div>
            </div>
            <a href="/api/download/${currentCode}/${file.id}" class="p-2 hover:bg-gray-50 rounded-xl text-gray-400 hover:text-blue-600 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </a>
        </div>
    `).join('');

    if (list) list.innerHTML = html || '<p class="text-center text-sm text-gray-400 py-8">Waiting for files...</p>';
    if (sentList) sentList.innerHTML = html;
});

function getFileIcon(type) {
    if (type.startsWith('image/')) return '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>';
    if (type.startsWith('video/')) return '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>';
    return '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>';
}

function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function resetToMenu() {
    location.reload(); // Simplest way to reset socket and state
}
