const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'DAMANE EUROPE - Expert Comptable',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // En dev, charger localhost. En prod, charger le build React.
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/build/index.html'));
  }

  // Menu personnalisé
  const menuTemplate = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouvelle Écriture', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('navigate', '/journal') },
        { label: 'Importer Documents', accelerator: 'CmdOrCtrl+I', click: () => mainWindow.webContents.send('navigate', '/documents') },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'Comptabilité',
      submenu: [
        { label: 'Plan Comptable', click: () => mainWindow.webContents.send('navigate', '/plan-comptable') },
        { label: 'Journal', click: () => mainWindow.webContents.send('navigate', '/journal') },
        { label: 'Grand Livre', click: () => mainWindow.webContents.send('navigate', '/grand-livre') },
        { type: 'separator' },
        { label: 'Bilan', click: () => mainWindow.webContents.send('navigate', '/bilan') },
        { label: 'Compte de Résultat', click: () => mainWindow.webContents.send('navigate', '/compte-resultat') },
      ],
    },
    {
      label: 'Outils',
      submenu: [
        { label: 'Transactions Bancaires', click: () => mainWindow.webContents.send('navigate', '/banque') },
        { label: 'Assistant IA', click: () => mainWindow.webContents.send('navigate', '/chat') },
        { type: 'separator' },
        { label: 'Ouvrir DevTools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'À propos', click: () => {
          const { dialog } = require('electron');
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'DAMANE EUROPE',
            message: 'Expert-Comptable v1.0.0',
            detail: 'Application de gestion comptable pour DAMANE EUROPE.\nDéveloppé avec Node.js, React et Electron.',
          });
        }},
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.on('closed', () => { /* cleanup */ });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
