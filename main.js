const { app, BrowserWindow } = require('electron');
const path = require('path');
const startServer = require('./server'); // We will modify server.js to export startServer()

// Désactivation de la sandbox essentielle pour lancer l'AppImage sous Linux sans les droits root
app.commandLine.appendSwitch('no-sandbox');

let mainWindow;

app.whenReady().then(async () => {
    // 1. Démarrer le serveur HTTP localement sur un port (3000 par défaut)
    const port = startServer(3000); 

    // 2. Créer la fenêtre Desktop
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: "LocalShare",
        // titleBarStyle: 'hidden', // Optionnel, pour un look plus moderne
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: path.join(__dirname, 'build/icon.png')
    });

    // On charge l'application comme un client classique sur le port local
    mainWindow.loadURL(`http://localhost:${port}`);
    // mainWindow.webContents.openDevTools(); // Debug
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
