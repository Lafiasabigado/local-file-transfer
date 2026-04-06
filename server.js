const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PORT = 3000;
const FILE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Ensure uploads directory exists and is clean
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
} else {
    fs.readdirSync(UPLOADS_DIR).forEach(file => {
        fs.unlinkSync(path.join(UPLOADS_DIR, file));
    });
}

// In-memory session store: { code: { files: [] } }
const sessions = {};

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

app.use(express.json());
app.use(express.static('public'));

// 1. Generate 6-digit session code
app.get('/api/session', (req, res) => {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (sessions[code]);
    
    sessions[code] = { files: [], createdAt: Date.now() };
    res.json({ code });
});

// 2. Upload file to session
app.post('/api/upload', upload.array('files'), (req, res) => {
    const { code } = req.body;
    if (!sessions[code]) {
        return res.status(404).json({ error: 'Session expired or invalid' });
    }

    const uploadedFiles = req.files.map(file => {
        const fileData = {
            id: file.filename,
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
            path: file.path
        };
        
        sessions[code].files.push(fileData);

        // Auto-delete after 5 minutes
        setTimeout(() => {
            if (fs.existsSync(fileData.path)) {
                fs.unlinkSync(fileData.path);
                // Remove from session list
                sessions[code].files = sessions[code].files.filter(f => f.id !== fileData.id);
                io.to(code).emit('files-updated', sessions[code].files);
            }
        }, FILE_TIMEOUT);

        return fileData;
    });

    // Notify mobile users in this room
    io.to(code).emit('files-updated', sessions[code].files);
    res.json({ success: true, files: uploadedFiles });
});

// 3. Get files for a session
app.get('/api/files/:code', (req, res) => {
    const { code } = req.params;
    if (!sessions[code]) return res.status(404).json({ error: 'Invalid code' });
    res.json(sessions[code].files);
});

// 4. Download file
app.get('/api/download/:code/:fileId', (req, res) => {
    const { code, fileId } = req.params;
    if (!sessions[code]) return res.status(404).send('Session not found');
    
    const file = sessions[code].files.find(f => f.id === fileId);
    if (!file || !fs.existsSync(file.path)) return res.status(404).send('File not found');

    res.download(file.path, file.name);
});

// Socket.io for real-time join
io.on('connection', (socket) => {
    socket.on('join-session', (code) => {
        if (sessions[code]) {
            socket.join(code);
            socket.emit('files-updated', sessions[code].files);
        }
    });
});

// Helper: Get local IP address
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIp = getLocalIp();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at:`);
    console.log(`- Local:   http://localhost:${PORT}`);
    console.log(`- Network: http://${localIp}:${PORT}`);
});
