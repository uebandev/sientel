const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const Store = require('./store');
const VlessCore = require('./vless-core');

let mainWindow;
let tray;
let pendingDeepLink = null;
const store = new Store();
const vlessCore = new VlessCore();

// Register protocol handler for sientel://
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('sientel', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('sientel');
}

// Handle protocol on Windows (single instance)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    // Handle deep link from second instance
    const deepLink = commandLine.find(arg => arg.startsWith('sientel://'));
    if (deepLink) {
      handleDeepLink(deepLink);
    }
  });
}

// Handle deep link
function handleDeepLink(url) {
  console.log('Deep link received:', url);
  // sientel://add/https://sub.example.com/sub/xxx
  // or sientel://add/sub.example.com/sub/xxx (without protocol)
  if (url.startsWith('sientel://add/')) {
    let subUrl = url.replace('sientel://add/', '');
    // Ensure URL has protocol
    if (!subUrl.startsWith('http://') && !subUrl.startsWith('https://')) {
      subUrl = 'https://' + subUrl;
    }
    console.log('Subscription URL:', subUrl);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('add-subscription-url', subUrl);
    } else {
      pendingDeepLink = subUrl;
    }
  }
}

// Check for deep link in startup args
function extractSubUrl(deepLink) {
  let subUrl = deepLink.replace('sientel://add/', '');
  if (!subUrl.startsWith('http://') && !subUrl.startsWith('https://')) {
    subUrl = 'https://' + subUrl;
  }
  return subUrl;
}

const startupDeepLink = process.argv.find(arg => arg.startsWith('sientel://'));
if (startupDeepLink) {
  pendingDeepLink = extractSubUrl(startupDeepLink);
}

// Setup download progress callback
vlessCore.setProgressCallback((progress) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('download-progress', progress);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 650,
    minWidth: 900,
    minHeight: 550,
    resizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0f0f1a',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/ui/index.html');
  
  // Hide to tray instead of closing (keep connection alive)
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Flag to track if we're really quitting
app.isQuitting = false;

// Check if started with --hidden flag (auto-start)
const startHidden = process.argv.includes('--hidden');

app.whenReady().then(async () => {
  createWindow();
  
  // Ensure components are downloaded
  try {
    await vlessCore.ensureComponents();
  } catch (e) {
    console.error('Failed to download components:', e);
  }
  
  // Hide window if started with --hidden
  if (startHidden) {
    mainWindow.hide();
  }
  
  // Handle pending deep link after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      mainWindow.webContents.send('add-subscription-url', pendingDeepLink);
      pendingDeepLink = null;
    }
    
    // Auto-connect if enabled
    if (store.getAutoConnect()) {
      const lastServerId = store.getLastServer();
      if (lastServerId) {
        const servers = store.getServers();
        const server = servers.find(s => s.id === lastServerId);
        if (server) {
          const tunMode = store.getConnectionMode() === 'tun';
          console.log('Auto-connecting to:', server.name);
          vlessCore.connect(server, tunMode).then(() => {
            mainWindow.webContents.send('status-changed', { connected: true, server, tunMode });
          }).catch(e => {
            console.error('Auto-connect failed:', e);
          });
        }
      }
    }
  });
  createTray();
});

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    tray = new Tray(iconPath);
    
    const updateTrayMenu = () => {
      const isConnected = vlessCore.connected;
      const serverName = vlessCore.currentServer?.name || '';
      
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Открыть Sientel', click: () => mainWindow.show() },
        { type: 'separator' },
        { 
          label: isConnected ? `✓ ${serverName}` : 'Не подключено',
          enabled: false 
        },
        { 
          label: isConnected ? 'Отключиться' : 'Подключиться',
          click: async () => {
            if (isConnected) {
              await vlessCore.disconnect();
              mainWindow.webContents.send('status-changed', { connected: false });
            } else {
              mainWindow.show();
            }
            updateTrayMenu();
          }
        },
        { type: 'separator' },
        { 
          label: 'Выход', 
          click: async () => { 
            app.isQuitting = true;
            await vlessCore.disconnect(); 
            app.quit(); 
          } 
        }
      ]);
      tray.setContextMenu(contextMenu);
    };
    
    tray.setToolTip('Sientel Client');
    tray.on('click', () => mainWindow.show());
    
    updateTrayMenu();
    
    // Update tray menu when connection status changes
    setInterval(updateTrayMenu, 3000);
  } catch (e) {
    console.log('Tray creation failed:', e.message);
  }
}

// Window control handlers
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow.hide());

// IPC handlers
ipcMain.handle('get-servers', () => store.getServers());
ipcMain.handle('get-subscriptions', () => store.getSubscriptions());

ipcMain.handle('test-ping', async (_, server) => {
  const net = require('net');
  const tls = require('tls');
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeout = 5000;
    let resolved = false;
    
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      if (socket) socket.destroy();
      resolve(result);
    };
    
    const options = {
      host: server.address,
      port: server.port,
      timeout: timeout
    };
    
    let socket;
    const useTls = server.security === 'tls' || server.security === 'reality';
    
    if (useTls) {
      options.servername = server.sni || server.address;
      options.rejectUnauthorized = false;
      socket = tls.connect(options);
      
      socket.on('secureConnect', () => {
        done({ success: true, ping: Date.now() - startTime });
      });
    } else {
      socket = net.connect(options);
      
      socket.on('connect', () => {
        done({ success: true, ping: Date.now() - startTime });
      });
    }
    
    socket.on('error', (err) => {
      done({ success: false, error: err.message });
    });
    
    socket.on('timeout', () => {
      done({ success: false, error: 'Timeout' });
    });
    
    setTimeout(() => {
      done({ success: false, error: 'Timeout' });
    }, timeout);
  });
});

ipcMain.handle('add-subscription', async (_, url, name) => {
  // First fetch and parse subscription data before adding to store
  const result = await fetchSubscription(url);
  
  if (!result.success) {
    throw new Error(result.error);
  }
  
  if (result.servers.length === 0) {
    throw new Error('Подписка не содержит серверов');
  }
  
  // Now add subscription with fetched data
  let subName = result.name || name || 'Подписка';
  if (!result.name && !name) {
    try {
      const urlObj = new URL(url);
      subName = urlObj.hostname.split('.')[0].toUpperCase();
    } catch {}
  }
  
  const sub = store.addSubscription({ url, name: subName, traffic: result.traffic });
  store.updateServersFromSub(sub.id, result.servers);
  mainWindow.webContents.send('servers-updated');
  return sub;
});

ipcMain.handle('update-subscription', async (_, id) => {
  const subs = store.getSubscriptions();
  const sub = subs.find(s => s.id === id);
  if (sub) await updateSubscription(id, sub.url);
});

ipcMain.handle('remove-subscription', (_, id) => store.removeSubscription(id));
ipcMain.handle('add-server', (_, server) => store.addServer(server));
ipcMain.handle('remove-server', (_, id) => store.removeServer(id));

ipcMain.handle('connect', async (_, serverId, tunMode = false) => {
  const servers = store.getServers();
  const server = servers.find(s => s.id === serverId);
  if (server) {
    await vlessCore.connect(server, tunMode);
    // Save last server and mode
    store.setLastServer(serverId);
    store.setConnectionMode(tunMode ? 'tun' : 'proxy');
    mainWindow.webContents.send('status-changed', { connected: true, server, tunMode });
  }
});

ipcMain.handle('get-last-server', () => store.getLastServer());
ipcMain.handle('get-connection-mode', () => store.getConnectionMode());

// Auto-start settings
ipcMain.handle('get-auto-connect', () => store.getAutoConnect());
ipcMain.handle('set-auto-connect', (_, enabled) => {
  store.setAutoConnect(enabled);
});

ipcMain.handle('get-start-with-windows', () => store.getStartWithWindows());
ipcMain.handle('set-start-with-windows', (_, enabled) => {
  store.setStartWithWindows(enabled);
  
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  
  if (isWindows) {
    // Windows: use login items
    const exePath = process.execPath;
    if (enabled) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: exePath,
        args: ['--hidden']
      });
    } else {
      app.setLoginItemSettings({
        openAtLogin: false
      });
    }
  } else if (isLinux) {
    // Linux: create .desktop file in autostart
    const fs = require('fs');
    const autostartDir = path.join(process.env.HOME, '.config', 'autostart');
    const desktopFile = path.join(autostartDir, 'sientel.desktop');
    
    try {
      if (enabled) {
        // Create autostart directory if it doesn't exist
        if (!fs.existsSync(autostartDir)) {
          fs.mkdirSync(autostartDir, { recursive: true });
        }
        
        // Get executable path
        const execPath = process.execPath;
        
        // Create .desktop file
        const desktopContent = `[Desktop Entry]
Type=Application
Name=Sientel
Comment=VPN Client
Exec=${execPath} --hidden
Icon=sientel
Terminal=false
Categories=Network;
X-GNOME-Autostart-enabled=true
`;
        fs.writeFileSync(desktopFile, desktopContent);
        fs.chmodSync(desktopFile, 0o755);
        console.log('Linux autostart enabled');
      } else {
        // Remove .desktop file
        if (fs.existsSync(desktopFile)) {
          fs.unlinkSync(desktopFile);
          console.log('Linux autostart disabled');
        }
      }
    } catch (e) {
      console.error('Failed to set Linux autostart:', e.message);
    }
  }
});

// Game detection settings
ipcMain.handle('get-disconnect-on-game', () => store.getDisconnectOnGame());
ipcMain.handle('set-disconnect-on-game', (_, enabled) => {
  store.setDisconnectOnGame(enabled);
  if (enabled) {
    startGameMonitor();
  } else {
    stopGameMonitor();
  }
});

// Game process monitor
const GAME_PROCESSES = [
  'cs2.exe', 'csgo.exe', 'cs2', 'csgo',           // Counter-Strike
  'valorant.exe', 'valorant-win64-shipping.exe', 'valorant', // Valorant
  'dota2.exe', 'dota2',                      // Dota 2
  'fortnite.exe', 'fortniteclient-win64-shipping.exe', 'fortnite', // Fortnite
  'r5apex.exe', 'r5apex',                     // Apex Legends
  'pubg.exe', 'tslgame.exe', 'pubg', 'tslgame',        // PUBG
  'overwatch.exe', 'overwatch',                  // Overwatch
  'leagueclient.exe', 'league of legends.exe', 'leagueclient', // LoL
  'rocketleague.exe', 'rocketleague',               // Rocket League
  'rainbowsix.exe', 'rainbowsix',                 // Rainbow Six
  'escapefromtarkov.exe', 'escapefromtarkov',           // Tarkov
  'rust.exe', 'rust',                       // Rust
  'gta5.exe', 'gtavlauncher.exe', 'gta5',   // GTA V
  'warzone.exe', 'cod.exe', 'warzone', 'cod',         // Call of Duty
  'destiny2.exe', 'destiny2'                    // Destiny 2
];

let gameMonitorInterval = null;
let wasConnectedBeforeGame = false;

function startGameMonitor() {
  if (gameMonitorInterval) return;
  
  gameMonitorInterval = setInterval(async () => {
    if (!store.getDisconnectOnGame()) return;
    
    const gameRunning = await isGameRunning();
    
    if (gameRunning && vlessCore.connected) {
      // Game started - disconnect
      wasConnectedBeforeGame = true;
      console.log('Game detected, disconnecting VPN...');
      await vlessCore.disconnect();
      mainWindow.webContents.send('status-changed', { connected: false });
      mainWindow.webContents.send('game-detected', { disconnected: true });
    } else if (!gameRunning && wasConnectedBeforeGame && !vlessCore.connected) {
      // Game closed - reconnect
      wasConnectedBeforeGame = false;
      const lastServerId = store.getLastServer();
      if (lastServerId) {
        const servers = store.getServers();
        const server = servers.find(s => s.id === lastServerId);
        if (server) {
          console.log('Game closed, reconnecting VPN...');
          const tunMode = store.getConnectionMode() === 'tun';
          try {
            await vlessCore.connect(server, tunMode);
            mainWindow.webContents.send('status-changed', { connected: true, server, tunMode });
            mainWindow.webContents.send('game-closed', { reconnected: true });
          } catch (e) {
            console.error('Reconnect failed:', e);
          }
        }
      }
    }
  }, 5000); // Check every 5 seconds
}

function stopGameMonitor() {
  if (gameMonitorInterval) {
    clearInterval(gameMonitorInterval);
    gameMonitorInterval = null;
  }
}

async function isGameRunning() {
  const { exec } = require('child_process');
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  
  return new Promise((resolve) => {
    if (isWindows) {
      exec('tasklist /FO CSV /NH', { encoding: 'utf8' }, (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const lower = stdout.toLowerCase();
        const found = GAME_PROCESSES.some(proc => lower.includes(proc.toLowerCase()));
        resolve(found);
      });
    } else if (isLinux) {
      exec('ps aux', { encoding: 'utf8' }, (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const lower = stdout.toLowerCase();
        const found = GAME_PROCESSES.some(proc => lower.includes(proc.toLowerCase()));
        resolve(found);
      });
    } else {
      resolve(false);
    }
  });
}

// Start game monitor if enabled
if (store.getDisconnectOnGame()) {
  startGameMonitor();
}

ipcMain.handle('disconnect', async () => {
  wasConnectedBeforeGame = false; // Reset flag on manual disconnect
  await vlessCore.disconnect();
  mainWindow.webContents.send('status-changed', { connected: false });
});

ipcMain.handle('get-status', () => vlessCore.getStatus());

// Get current IP address (uses system proxy when connected)
ipcMain.handle('get-ip', async () => {
  const { net } = require('electron');
  
  return new Promise((resolve) => {
    // Use electron net module - it respects system proxy settings
    const request = net.request({
      method: 'GET',
      url: 'https://api.ipify.org?format=json'
    });
    
    let data = '';
    
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        data += chunk.toString();
      });
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ success: true, ip: json.ip });
        } catch {
          resolve({ success: false, error: 'Parse error' });
        }
      });
    });
    
    request.on('error', (e) => {
      resolve({ success: false, error: e.message });
    });
    
    // Timeout
    setTimeout(() => {
      request.abort();
      resolve({ success: false, error: 'Timeout' });
    }, 10000);
    
    request.end();
  });
});

// About page handlers
ipcMain.handle('get-app-info', () => {
  const os = require('os');
  
  return {
    appVersion: require('../package.json').version,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: `${os.platform()} ${os.arch()}`,
    osVersion: os.release(),
    hwid: getHwid()
  };
});

ipcMain.handle('get-core-versions', async () => {
  const fs = require('fs');
  const { execSync } = require('child_process');
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  
  const configPath = isWindows 
    ? path.join(process.env.APPDATA, '.sientel-client')
    : path.join(process.env.HOME, '.config', 'sientel-client');
  
  let xrayVersion = 'Не установлен';
  let singboxVersion = 'Не установлен';
  
  try {
    const xrayPath = path.join(configPath, isWindows ? 'xray.exe' : 'xray');
    if (fs.existsSync(xrayPath)) {
      const output = execSync(`"${xrayPath}" version`, { encoding: 'utf8', timeout: 5000 });
      const match = output.match(/Xray (\d+\.\d+\.\d+)/);
      if (match) xrayVersion = match[1];
    }
  } catch {}
  
  try {
    const singboxPath = path.join(configPath, isWindows ? 'sing-box.exe' : 'sing-box');
    if (fs.existsSync(singboxPath)) {
      const output = execSync(`"${singboxPath}" version`, { encoding: 'utf8', timeout: 5000 });
      const match = output.match(/sing-box version (\d+\.\d+\.\d+)/);
      if (match) singboxVersion = match[1];
    }
  } catch {}
  
  return { xrayVersion, singboxVersion };
});

// Get Windows Machine GUID or Linux machine-id for HWID
function getHwid() {
  const { execSync } = require('child_process');
  const crypto = require('crypto');
  const os = require('os');
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  
  try {
    if (isWindows) {
      const output = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' });
      const match = output.match(/MachineGuid\s+REG_SZ\s+(.+)/);
      if (match) return match[1].trim();
    } else if (isLinux) {
      // Try /etc/machine-id first (systemd)
      try {
        const machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        if (machineId) {
          // Format as UUID-like string
          return `${machineId.slice(0,8)}-${machineId.slice(8,12)}-${machineId.slice(12,16)}-${machineId.slice(16,20)}-${machineId.slice(20,32)}`;
        }
      } catch {}
      
      // Fallback to /var/lib/dbus/machine-id
      try {
        const machineId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
        if (machineId) {
          return `${machineId.slice(0,8)}-${machineId.slice(8,12)}-${machineId.slice(12,16)}-${machineId.slice(16,20)}-${machineId.slice(20,32)}`;
        }
      } catch {}
    }
  } catch {}
  
  // Fallback: generate from system info
  const hash = crypto.createHash('md5')
    .update(os.hostname() + os.platform() + os.arch() + (os.cpus()[0]?.model || ''))
    .digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

// Fetch subscription data without saving
async function fetchSubscription(url) {
  const { net } = require('electron');
  
  const hwid = getHwid();
  
  // Common User-Agents for different subscription services
  const userAgents = [
    'Happ/0.6.0',
    'ClashForAndroid/2.5.12',
    'Clash/1.0',
    'v2rayNG/1.8.5',
    'ShadowRocket/1892'
  ];
  
  return new Promise((resolve) => {
    const request = net.request({ method: 'GET', url });
    // Use Happ UA as primary, most services support it
    request.setHeader('User-Agent', userAgents[0]);
    request.setHeader('Accept', '*/*');
    request.setHeader('Accept-Language', 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7');
    request.setHeader('X-HWID', hwid);
    
    let responseData = '';
    let headers = {};
    
    request.on('response', (response) => {
      headers = response.headers;
      response.on('data', (chunk) => { responseData += chunk.toString(); });
      response.on('end', () => {
        const result = processSubscriptionData(responseData, headers);
        resolve(result);
      });
    });
    
    request.on('error', (e) => {
      resolve({ success: false, error: e.message, servers: [] });
    });
    
    request.end();
  });
}

// Process subscription data and return parsed result
function processSubscriptionData(data, headers) {
  const getHeader = (name) => {
    const val = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };
  
  const announce = getHeader('announce');
  const profileTitle = getHeader('profile-title');
  const subInfo = getHeader('subscription-userinfo');
  
  // Check for error message
  if (announce && data.length === 0) {
    try {
      const msg = Buffer.from(announce.replace('base64:', ''), 'base64').toString('utf8');
      return { success: false, error: msg, servers: [] };
    } catch {}
  }
  
  if (data.length === 0) {
    return { success: false, error: 'Сервер вернул пустой ответ', servers: [] };
  }
  
  // Parse name from header
  let name = null;
  if (profileTitle) {
    try {
      name = Buffer.from(profileTitle.replace('base64:', ''), 'base64').toString('utf8');
    } catch {}
  }
  
  // Parse traffic info
  let traffic = null;
  if (subInfo) {
    traffic = {};
    subInfo.split(';').forEach(p => {
      const [k, v] = p.trim().split('=');
      if (k && v) traffic[k.trim()] = parseInt(v.trim());
    });
  }
  
  const servers = parseSubscription(data);
  return { success: true, servers, name, traffic };
}

// Update existing subscription
async function updateSubscription(subId, url) {
  const result = await fetchSubscription(url);
  
  if (!result.success) {
    mainWindow.webContents.send('subscription-error', result.error);
    return;
  }
  
  // Update subscription metadata
  const allData = store.load();
  const sub = allData.subscriptions.find(s => s.id === subId);
  if (sub) {
    if (result.name) sub.name = result.name;
    if (result.traffic) sub.traffic = result.traffic;
    store.save(allData);
  }
  
  store.updateServersFromSub(subId, result.servers);
  mainWindow.webContents.send('servers-updated');
}

function parseSubscription(data) {
  const servers = [];
  let decoded = data.trim();
  
  // Try to detect and parse JSON format (Clash/Sing-box configs)
  if (decoded.startsWith('{') || decoded.startsWith('proxies:') || decoded.startsWith('outbounds:')) {
    try {
      const jsonServers = parseJsonConfig(decoded);
      if (jsonServers.length > 0) {
        console.log('Parsed JSON config, found servers:', jsonServers.length);
        return jsonServers;
      }
    } catch (e) {
      console.log('JSON parse failed:', e.message);
    }
  }
  
  // Try base64 decode (standard and URL-safe variants)
  const tryBase64Decode = (str) => {
    // Remove whitespace
    str = str.replace(/\s/g, '');
    
    // Try URL-safe base64 first (replace - with + and _ with /)
    let normalized = str.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    while (normalized.length % 4 !== 0) {
      normalized += '=';
    }
    
    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      // Validate decoded content
      if (decoded.includes('://') || decoded.includes('vless') || decoded.includes('vmess') || 
          decoded.includes('trojan') || decoded.includes('ss://') || decoded.includes('hy2://')) {
        return decoded;
      }
    } catch {}
    
    // Try standard base64
    try {
      const decoded = Buffer.from(str, 'base64').toString('utf8');
      if (decoded.includes('://') || decoded.includes('vless') || decoded.includes('vmess')) {
        return decoded;
      }
    } catch {}
    
    return null;
  };
  
  const base64Decoded = tryBase64Decode(decoded);
  if (base64Decoded) {
    decoded = base64Decoded;
    console.log('Base64 decoded successfully');
  }
  
  console.log('Decoded data preview:', decoded.substring(0, 300));
  
  // Split by newlines, spaces, or common separators
  const lines = decoded.split(/[\n\r\s]+/).filter(l => l.trim() && l.includes('://'));
  console.log('Found URI lines:', lines.length);
  
  // Also try to find URIs embedded in text (some providers wrap them)
  const uriPattern = /(vless|vmess|trojan|ss|ssr|socks5?|hy2?|hysteria2?|tuic):\/\/[^\s<>"']+/gi;
  const embeddedUris = decoded.match(uriPattern) || [];
  
  // Combine and deduplicate
  const allUris = [...new Set([...lines, ...embeddedUris])];
  console.log('Total URIs to parse:', allUris.length);
  
  for (const line of allUris) {
    const trimmed = line.trim();
    let server = null;
    
    if (trimmed.startsWith('vless://')) {
      server = parseVlessUri(trimmed);
    } else if (trimmed.startsWith('vmess://')) {
      server = parseVmessUri(trimmed);
    } else if (trimmed.startsWith('trojan://')) {
      server = parseTrojanUri(trimmed);
    } else if (trimmed.startsWith('ss://')) {
      server = parseShadowsocksUri(trimmed);
    } else if (trimmed.startsWith('ssr://')) {
      server = parseShadowsocksRUri(trimmed);
    } else if (trimmed.startsWith('socks://') || trimmed.startsWith('socks5://')) {
      server = parseSocksUri(trimmed);
    } else if (trimmed.startsWith('hy2://') || trimmed.startsWith('hysteria2://')) {
      server = parseHysteria2Uri(trimmed);
    } else if (trimmed.startsWith('hy://') || trimmed.startsWith('hysteria://')) {
      server = parseHysteriaUri(trimmed);
    } else if (trimmed.startsWith('tuic://')) {
      server = parseTuicUri(trimmed);
    }
    
    if (server) servers.push(server);
  }
  
  return servers;
}

// Parse JSON configs (Clash YAML-like or Sing-box JSON)
function parseJsonConfig(data) {
  const servers = [];
  
  try {
    // Try parsing as JSON first
    let config;
    if (data.startsWith('{')) {
      config = JSON.parse(data);
    } else {
      // Simple YAML-like parsing for Clash format
      return parseClashYaml(data);
    }
    
    // Sing-box format
    if (config.outbounds) {
      for (const outbound of config.outbounds) {
        const server = parseSingboxOutbound(outbound);
        if (server) servers.push(server);
      }
    }
    
    // Clash JSON format
    if (config.proxies) {
      for (const proxy of config.proxies) {
        const server = parseClashProxy(proxy);
        if (server) servers.push(server);
      }
    }
  } catch (e) {
    console.log('JSON config parse error:', e.message);
  }
  
  return servers;
}

// Parse Clash YAML format (simplified)
function parseClashYaml(data) {
  const servers = [];
  const lines = data.split('\n');
  let inProxies = false;
  let currentProxy = {};
  let indent = 0;
  
  for (const line of lines) {
    if (line.trim() === 'proxies:') {
      inProxies = true;
      continue;
    }
    
    if (!inProxies) continue;
    
    // New proxy starts with "- "
    if (line.match(/^\s*-\s+\w+:/)) {
      if (Object.keys(currentProxy).length > 0) {
        const server = parseClashProxy(currentProxy);
        if (server) servers.push(server);
      }
      currentProxy = {};
    }
    
    // Parse key: value
    const match = line.match(/^\s*-?\s*(\w+):\s*(.+)$/);
    if (match) {
      let value = match[2].trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      currentProxy[match[1]] = value;
    }
  }
  
  // Don't forget last proxy
  if (Object.keys(currentProxy).length > 0) {
    const server = parseClashProxy(currentProxy);
    if (server) servers.push(server);
  }
  
  return servers;
}

// Parse Clash proxy object
function parseClashProxy(proxy) {
  const type = proxy.type?.toLowerCase();
  if (!type || !proxy.server || !proxy.port) return null;
  
  const base = {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    name: proxy.name || `${proxy.server}:${proxy.port}`,
    address: proxy.server,
    port: parseInt(proxy.port)
  };
  
  // Normalize network
  let network = proxy.network || 'tcp';
  if (network === 'gun') network = 'grpc';
  
  if (type === 'vless') {
    return {
      ...base,
      type: 'vless',
      uuid: proxy.uuid,
      security: proxy.tls ? 'tls' : (proxy.reality ? 'reality' : 'none'),
      sni: proxy.servername || proxy.sni || proxy.server,
      network,
      flow: proxy.flow || '',
      path: proxy['ws-opts']?.path || proxy['grpc-opts']?.['grpc-service-name'] || proxy.path || '/',
      serviceName: proxy['grpc-opts']?.['grpc-service-name'] || '',
      host: proxy['ws-opts']?.headers?.Host || proxy.host || '',
      fp: proxy['client-fingerprint'] || proxy.fingerprint || '',
      pbk: proxy['reality-opts']?.['public-key'] || '',
      sid: proxy['reality-opts']?.['short-id'] || '',
      grpcMode: proxy['grpc-opts']?.mode || 'gun'
    };
  }
  
  if (type === 'vmess') {
    return {
      ...base,
      type: 'vmess',
      uuid: proxy.uuid,
      alterId: proxy.alterId || 0,
      security: proxy.tls ? 'tls' : 'none',
      sni: proxy.servername || proxy.server,
      network,
      path: proxy['ws-opts']?.path || proxy['grpc-opts']?.['grpc-service-name'] || '/',
      serviceName: proxy['grpc-opts']?.['grpc-service-name'] || '',
      host: proxy['ws-opts']?.headers?.Host || '',
      grpcMode: proxy['grpc-opts']?.mode || 'gun'
    };
  }
  
  if (type === 'trojan') {
    return {
      ...base,
      type: 'trojan',
      password: proxy.password,
      security: 'tls',
      sni: proxy.sni || proxy.server,
      network,
      path: proxy['ws-opts']?.path || proxy['grpc-opts']?.['grpc-service-name'] || '/',
      serviceName: proxy['grpc-opts']?.['grpc-service-name'] || '',
      grpcMode: proxy['grpc-opts']?.mode || 'gun'
    };
  }
  
  if (type === 'ss' || type === 'shadowsocks') {
    return {
      ...base,
      type: 'shadowsocks',
      method: proxy.cipher,
      password: proxy.password
    };
  }
  
  if (type === 'hysteria2' || type === 'hy2') {
    return {
      ...base,
      type: 'hysteria2',
      password: proxy.password || proxy.auth,
      sni: proxy.sni || proxy.server,
      insecure: proxy['skip-cert-verify'] || false
    };
  }
  
  return null;
}

// Parse Sing-box outbound
function parseSingboxOutbound(outbound) {
  const type = outbound.type;
  if (!type || !outbound.server || !outbound.server_port) return null;
  if (['direct', 'block', 'dns', 'selector', 'urltest'].includes(type)) return null;
  
  const base = {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    name: outbound.tag || `${outbound.server}:${outbound.server_port}`,
    address: outbound.server,
    port: outbound.server_port
  };
  
  // Determine network type
  let network = outbound.transport?.type || 'tcp';
  if (network === 'gun') network = 'grpc';
  
  if (type === 'vless') {
    return {
      ...base,
      type: 'vless',
      uuid: outbound.uuid,
      security: outbound.tls?.enabled ? (outbound.tls?.reality?.enabled ? 'reality' : 'tls') : 'none',
      sni: outbound.tls?.server_name || outbound.server,
      network,
      flow: outbound.flow || '',
      path: outbound.transport?.path || outbound.transport?.service_name || '/',
      serviceName: outbound.transport?.service_name || '',
      host: outbound.transport?.headers?.Host || '',
      fp: outbound.tls?.utls?.fingerprint || '',
      pbk: outbound.tls?.reality?.public_key || '',
      sid: outbound.tls?.reality?.short_id || ''
    };
  }
  
  if (type === 'vmess') {
    return {
      ...base,
      type: 'vmess',
      uuid: outbound.uuid,
      security: outbound.tls?.enabled ? 'tls' : 'none',
      network,
      path: outbound.transport?.path || outbound.transport?.service_name || '/',
      serviceName: outbound.transport?.service_name || ''
    };
  }
  
  if (type === 'trojan') {
    return {
      ...base,
      type: 'trojan',
      password: outbound.password,
      security: 'tls',
      sni: outbound.tls?.server_name || outbound.server,
      network,
      path: outbound.transport?.path || outbound.transport?.service_name || '/',
      serviceName: outbound.transport?.service_name || ''
    };
  }
  
  if (type === 'shadowsocks') {
    return {
      ...base,
      type: 'shadowsocks',
      method: outbound.method,
      password: outbound.password
    };
  }
  
  if (type === 'hysteria2') {
    return {
      ...base,
      type: 'hysteria2',
      password: outbound.password,
      sni: outbound.tls?.server_name || outbound.server
    };
  }
  
  return null;
}

// Parse Hysteria2 URI
function parseHysteria2Uri(uri) {
  try {
    const url = new URL(uri.replace('hysteria2://', 'hy2://').replace('hy2://', 'http://'));
    const password = url.username || '';
    const host = url.hostname;
    const port = parseInt(url.port) || 443;
    const params = Object.fromEntries(url.searchParams);
    
    let name = `${host}:${port}`;
    try {
      name = decodeURIComponent(url.hash.slice(1)) || name;
    } catch {}
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: host,
      port,
      password,
      type: 'hysteria2',
      sni: params.sni || host,
      insecure: params.insecure === '1'
    };
  } catch {
    return null;
  }
}

// Parse Hysteria (v1) URI
function parseHysteriaUri(uri) {
  try {
    const url = new URL(uri.replace('hysteria://', 'http://').replace('hy://', 'http://'));
    const host = url.hostname;
    const port = parseInt(url.port) || 443;
    const params = Object.fromEntries(url.searchParams);
    
    let name = `${host}:${port}`;
    try {
      name = decodeURIComponent(url.hash.slice(1)) || name;
    } catch {}
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: host,
      port,
      password: params.auth || url.username || '',
      type: 'hysteria',
      sni: params.peer || params.sni || host,
      protocol: params.protocol || 'udp',
      insecure: params.insecure === '1'
    };
  } catch {
    return null;
  }
}

// Parse TUIC URI
function parseTuicUri(uri) {
  try {
    const url = new URL(uri.replace('tuic://', 'http://'));
    const uuid = url.username;
    const password = url.password || '';
    const host = url.hostname;
    const port = parseInt(url.port) || 443;
    const params = Object.fromEntries(url.searchParams);
    
    let name = `${host}:${port}`;
    try {
      name = decodeURIComponent(url.hash.slice(1)) || name;
    } catch {}
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: host,
      port,
      uuid,
      password,
      type: 'tuic',
      sni: params.sni || host,
      congestion: params.congestion_control || 'bbr',
      alpn: params.alpn?.split(',') || ['h3']
    };
  } catch {
    return null;
  }
}

// Parse ShadowsocksR URI
function parseShadowsocksRUri(uri) {
  try {
    let encoded = uri.replace('ssr://', '');
    // URL-safe base64
    encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (encoded.length % 4 !== 0) encoded += '=';
    
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    // Format: server:port:protocol:method:obfs:base64pass/?params
    const match = decoded.match(/^(.+):(\d+):(.+):(.+):(.+):(.+?)(?:\/\?(.*))?$/);
    if (!match) return null;
    
    const [, server, port, protocol, method, obfs, passB64, paramsStr] = match;
    let password = Buffer.from(passB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    
    let name = `${server}:${port}`;
    if (paramsStr) {
      const params = new URLSearchParams(paramsStr);
      const remarks = params.get('remarks');
      if (remarks) {
        try {
          name = Buffer.from(remarks.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        } catch {}
      }
    }
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: server,
      port: parseInt(port),
      method,
      password,
      type: 'shadowsocksr',
      protocol,
      obfs
    };
  } catch {
    return null;
  }
}

function parseTrojanUri(uri) {
  try {
    // Handle special characters in password
    const hashIdx = uri.lastIndexOf('#');
    let rawName = '';
    let cleanUri = uri;
    if (hashIdx > 0) {
      rawName = uri.slice(hashIdx + 1);
      cleanUri = uri.slice(0, hashIdx);
    }
    
    const url = new URL(cleanUri);
    const password = decodeURIComponent(url.username);
    const host = url.hostname;
    const port = parseInt(url.port) || 443;
    const params = Object.fromEntries(url.searchParams);
    
    let name = `${host}:${port}`;
    if (rawName) {
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = rawName;
      }
    }
    
    // Normalize network
    let network = params.type || params.network || 'tcp';
    if (network === 'h2') network = 'http';
    if (network === 'gun') network = 'grpc';
    
    // Get serviceName for gRPC
    let serviceName = '';
    let path = '/';
    if (network === 'grpc') {
      serviceName = params.serviceName || params.path || '';
      path = serviceName;
    } else {
      try {
        path = params.path ? decodeURIComponent(params.path) : '/';
      } catch {
        path = params.path || '/';
      }
    }
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: host,
      port,
      password,
      type: 'trojan',
      security: params.security || 'tls',
      sni: params.sni || params.peer || params.serverName || host,
      network,
      path,
      serviceName,
      host: params.host || host,
      fp: params.fp || params.fingerprint || '',
      allowInsecure: params.allowInsecure === '1' || params.insecure === '1',
      grpcMode: params.mode || 'gun'
    };
  } catch (e) {
    console.error('Failed to parse Trojan URI:', e.message);
    return null;
  }
}

function parseShadowsocksUri(uri) {
  try {
    // ss://BASE64(method:password)@host:port#name
    // or ss://BASE64(method:password@host:port)#name
    let url;
    const hashIndex = uri.indexOf('#');
    let name = '';
    
    if (hashIndex > 0) {
      name = decodeURIComponent(uri.slice(hashIndex + 1));
      uri = uri.slice(0, hashIndex);
    }
    
    const mainPart = uri.replace('ss://', '');
    
    // Try to parse as URL first
    if (mainPart.includes('@')) {
      const [encoded, hostPort] = mainPart.split('@');
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const [method, password] = decoded.split(':');
      const [host, port] = hostPort.split(':');
      
      return {
        id: Date.now().toString() + Math.random().toString(36).slice(2),
        name: name || `${host}:${port}`,
        address: host,
        port: parseInt(port) || 443,
        method,
        password,
        type: 'shadowsocks'
      };
    } else {
      // Fully encoded
      const decoded = Buffer.from(mainPart, 'base64').toString('utf8');
      const match = decoded.match(/^(.+?):(.+?)@(.+?):(\d+)$/);
      if (match) {
        return {
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          name: name || `${match[3]}:${match[4]}`,
          address: match[3],
          port: parseInt(match[4]),
          method: match[1],
          password: match[2],
          type: 'shadowsocks'
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseSocksUri(uri) {
  try {
    const url = new URL(uri.replace('socks5://', 'socks://'));
    const host = url.hostname;
    const port = parseInt(url.port) || 1080;
    const username = url.username || '';
    const password = url.password || '';
    
    let name = `${host}:${port}`;
    try {
      name = decodeURIComponent(url.hash.slice(1)) || name;
    } catch {}
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: host,
      port,
      username,
      password,
      type: 'socks'
    };
  } catch {
    return null;
  }
}

function parseVmessUri(uri) {
  try {
    let b64 = uri.replace('vmess://', '');
    // Handle URL-safe base64
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    
    // Normalize network type
    let network = json.net || json.network || 'tcp';
    if (network === 'h2') network = 'http';
    if (network === 'splithttp') network = 'xhttp';
    if (network === 'gun') network = 'grpc';
    
    // Get serviceName for gRPC
    let serviceName = '';
    let path = json.path || '/';
    if (network === 'grpc') {
      serviceName = json.path || json.serviceName || '';
      path = serviceName;
    }
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name: json.ps || json.remarks || json.name || `${json.add}:${json.port}`,
      address: json.add || json.address,
      port: parseInt(json.port) || 443,
      uuid: json.id || json.uuid,
      alterId: parseInt(json.aid || json.alterId) || 0,
      type: 'vmess',
      security: (json.tls === 'tls' || json.tls === '1' || json.tls === true) ? 'tls' : 'none',
      sni: json.sni || json.host || json.add,
      network,
      path,
      serviceName,
      host: json.host || json.add,
      fp: json.fp || json.fingerprint || '',
      grpcMode: json.type || 'gun' // gun or multi
    };
  } catch (e) {
    console.error('Failed to parse VMess URI:', e.message);
    return null;
  }
}

function parseVlessUri(uri) {
  if (!uri.startsWith('vless://')) return null;
  try {
    // Handle URL encoding issues and special characters in name
    let cleanUri = uri;
    
    // Extract and encode fragment (name) separately to handle special chars
    const hashIdx = uri.lastIndexOf('#');
    let rawName = '';
    if (hashIdx > 0) {
      rawName = uri.slice(hashIdx + 1);
      cleanUri = uri.slice(0, hashIdx);
    }
    
    const url = new URL(cleanUri);
    const uuid = url.username;
    const host = url.hostname;
    const port = parseInt(url.port) || 443;
    const params = Object.fromEntries(url.searchParams);
    
    // Decode name with fallbacks
    let name = `${host}:${port}`;
    if (rawName) {
      try {
        name = decodeURIComponent(rawName);
      } catch {
        name = rawName; // Use as-is if decode fails
      }
    }
    
    // Normalize network type (different providers use different names)
    let network = params.type || params.network || 'tcp';
    if (network === 'splithttp') network = 'xhttp';
    if (network === 'h2') network = 'http';
    if (network === 'gun') network = 'grpc'; // gun is alias for grpc
    
    // Normalize security
    let security = params.security || 'none';
    if (params.tls === '1' || params.tls === 'true') security = 'tls';
    
    // Get path/serviceName with proper decoding
    let path = '/';
    let serviceName = '';
    try {
      if (network === 'grpc') {
        // For gRPC, serviceName is the main parameter
        serviceName = decodeURIComponent(params.serviceName || params.path || '');
        path = serviceName;
      } else {
        path = decodeURIComponent(params.path || '/');
      }
    } catch {
      path = params.path || params.serviceName || '/';
      serviceName = params.serviceName || '';
    }
    
    console.log('Parsed VLESS:', name, host, port, 'network:', network, 'security:', security);
    
    return {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name,
      address: host,
      port,
      uuid,
      type: 'vless',
      security,
      sni: params.sni || params.serverName || params.peer || host,
      flow: params.flow || '',
      path,
      serviceName: serviceName || path,
      host: params.host || params.sni || host,
      network,
      fp: params.fp || params.fingerprint || 'chrome',
      pbk: params.pbk || params.publicKey || '',
      sid: params.sid || params.shortId || '',
      alpn: params.alpn || '',
      allowInsecure: params.allowInsecure === '1' || params.insecure === '1',
      grpcMode: params.mode || 'gun' // gun or multi
    };
  } catch (e) {
    console.error('Failed to parse VLESS URI:', e.message, uri.substring(0, 50));
    return null;
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Graceful shutdown handlers
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`Received ${signal}, shutting down gracefully...`);
  app.isQuitting = true;
  
  const timeout = setTimeout(() => {
    console.error('Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 10000); // 10 seconds timeout
  
  try {
    await vlessCore.disconnect();
    clearTimeout(timeout);
    app.quit();
  } catch (e) {
    console.error('Shutdown error:', e);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  gracefulShutdown('unhandledRejection');
});
