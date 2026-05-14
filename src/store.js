const fs = require('fs');
const path = require('path');

class Store {
  constructor() {
    const isLinux = process.platform === 'linux';
    const isWindows = process.platform === 'win32';
    
    // Platform-specific config path
    if (isWindows) {
      this.configPath = path.join(process.env.APPDATA, '.vless-client');
    } else if (isLinux) {
      this.configPath = path.join(process.env.HOME, '.config', 'sientel-client');
    } else {
      // macOS fallback
      this.configPath = path.join(process.env.HOME, '.config', 'sientel-client');
    }
    
    this.dataFile = path.join(this.configPath, 'data.json');
    this.init();
  }

  init() {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });
    }
    if (!fs.existsSync(this.dataFile)) {
      this.save({ servers: [], subscriptions: [], settings: { autoConnect: false } });
    }
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    } catch {
      return { servers: [], subscriptions: [], settings: {} };
    }
  }

  save(data) {
    fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
  }

  getServers() { return this.load().servers; }
  getSubscriptions() { return this.load().subscriptions; }
  getSettings() { return this.load().settings || {}; }

  saveSettings(settings) {
    const data = this.load();
    data.settings = { ...data.settings, ...settings };
    this.save(data);
  }

  getLastServer() {
    const settings = this.getSettings();
    return settings.lastServerId || null;
  }

  setLastServer(serverId) {
    this.saveSettings({ lastServerId: serverId });
  }

  getConnectionMode() {
    const settings = this.getSettings();
    return settings.connectionMode || 'proxy';
  }

  setConnectionMode(mode) {
    this.saveSettings({ connectionMode: mode });
  }

  getAutoConnect() {
    return this.getSettings().autoConnect || false;
  }

  setAutoConnect(enabled) {
    this.saveSettings({ autoConnect: enabled });
  }

  getStartWithWindows() {
    return this.getSettings().startWithWindows || false;
  }

  setStartWithWindows(enabled) {
    this.saveSettings({ startWithWindows: enabled });
  }

  getDisconnectOnGame() {
    return this.getSettings().disconnectOnGame || false;
  }

  setDisconnectOnGame(enabled) {
    this.saveSettings({ disconnectOnGame: enabled });
  }

  addServer(server) {
    const data = this.load();
    server.id = Date.now().toString();
    data.servers.push(server);
    this.save(data);
    return server;
  }

  addSubscription(sub) {
    const data = this.load();
    sub.id = Date.now().toString();
    sub.addedAt = new Date().toISOString();
    data.subscriptions.push(sub);
    this.save(data);
    return sub;
  }

  updateServersFromSub(subId, servers) {
    const data = this.load();
    data.servers = data.servers.filter(s => s.subId !== subId);
    servers.forEach(s => { s.subId = subId; data.servers.push(s); });
    this.save(data);
  }

  removeSubscription(id) {
    const data = this.load();
    data.subscriptions = data.subscriptions.filter(s => s.id !== id);
    data.servers = data.servers.filter(s => s.subId !== id);
    this.save(data);
  }

  removeServer(id) {
    const data = this.load();
    data.servers = data.servers.filter(s => s.id !== id);
    this.save(data);
  }
}

module.exports = Store;
