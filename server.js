const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const FILE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

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

function startServer(preferredPort = 3000) {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' }});

    // Ensure uploads directory exists and is clean
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
        limits: { fileSize: 10 * 1024 * 1024 * 1024 } // Allow very large files locally (up to 10GB for this demo limit)
    });

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // 1. Generate 6-digit session code (Sender)
    app.get('/api/session', (req, res) => {
        let code;
        do {
            code = Math.floor(100000 + Math.random() * 900000).toString();
        } while (sessions[code]);
        
        sessions[code] = { files: [], createdAt: Date.now() };
        res.json({ code, localIp: getLocalIp(), port: preferredPort });
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

            // Auto-delete after timeout
            setTimeout(() => {
                if (fs.existsSync(fileData.path)) {
                    fs.unlinkSync(fileData.path);
                    if(sessions[code]) {
                        sessions[code].files = sessions[code].files.filter(f => f.id !== fileData.id);
                        io.to(code).emit('files-updated', sessions[code].files);
                    }
                }
            }, FILE_TIMEOUT);

            return fileData;
        });

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

        // Force browser to download instead of displaying
        res.download(file.path, file.name);
    });

    // Socket.io for real-time join & ECDH signaling
    io.on('connection', (socket) => {
        socket.on('join-session', (code) => {
            if (sessions[code]) {
                socket.join(code);
                socket.emit('files-updated', sessions[code].files);
                // Announce that someone joined, useful for ECDH signaling
                socket.to(code).emit('peer-joined', socket.id);
            } else {
                socket.emit('session-error', 'Invalid Session');
            }
        });

        // Universal signaling for ECDH Security
        socket.on('signal', (data) => {
            socket.to(data.code).emit('signal', data);
        });
    });

    // Start listening. Use try catch for port conflicts if possible...
    // To be simple, we just listen on the preferredPort.
    server.listen(preferredPort, '0.0.0.0', () => {
        console.log(`Server running at:`);
        console.log(`- Local:   http://localhost:${preferredPort}`);
        console.log(`- Network: http://${getLocalIp()}:${preferredPort}`);
    });

    return preferredPort;
}

module.exports = startServer;
