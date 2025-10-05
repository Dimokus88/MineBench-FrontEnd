const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const waitOn = require("wait-on");

let mainWindow;
let miner;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow external requests
      allowRunningInsecureContent: true,
      preload: path.join(__dirname, "preload.js")
    },
  });

  // Set user agent to avoid CORS issues
  mainWindow.webContents.setUserAgent('MinerApp/1.0');

  // Load from Vite dev server in development
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL("http://localhost:5174");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  
  mainWindow.webContents.openDevTools();
}

// Чекаємо, поки Electron готовий
app.whenReady().then(async () => {
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    // Wait for Vite dev server
    await waitOn({ resources: ["http://localhost:5174"], timeout: 30000 });
  }
  
  createWindow();
});

// Start/Stop майнера
ipcMain.handle("start-miner", (event, wallet, worker) => {
  const minerPath = "D:\\Mining\\Setup\\AMD\\lolMiner.exe";

  miner = spawn(minerPath, [
    "--algo", "NEXA",
    "--pool", "nexa.2miners.com:5050",
    "--user", `${wallet}.${worker}`,
    "--apiport", "4067"
  ]);

  miner.stdout.on("data", (data) => console.log(`Miner: ${data}`));
  miner.stderr.on("data", (data) => console.error(`Error: ${data}`));
  miner.on("close", (code) => console.log(`Miner exited with code ${code}`));

  return "Miner started";
});

ipcMain.handle("stop-miner", () => {
  if (miner) {
    miner.kill();
    miner = null;
    return "Miner stopped";
  }
  return "Miner not running";
});

// Add backend connection test using http module
ipcMain.handle("test-backend", async () => {
  const http = require('http');
  
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3001/health', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ success: true, data: parsed });
        } catch (e) {
          resolve({ success: false, error: 'Invalid JSON response' });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ success: false, error: 'Connection timeout' });
    });
  });
});

// Закриваємо всі вікна
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
