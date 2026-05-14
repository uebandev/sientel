const { ipcRenderer } = require('electron');

let servers = [];
let subscriptions = [];
let selectedServer = null;
let isConnected = false;
let connectionTimer = null;
let connectionStartTime = null;

// Toast notification system
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ'}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, duration);
  
  return toast;
}

// Flag cache and preloading
const flagCache = new Map();
const FLAG_CDN = 'https://flagcdn.com/24x18';

// Emoji fallback for countries
const EMOJI_FLAGS = {
  'RU': '🇷🇺', 'SE': '🇸🇪', 'FI': '🇫🇮', 'NL': '🇳🇱', 'DE': '🇩🇪',
  'US': '🇺🇸', 'GB': '🇬🇧', 'FR': '🇫🇷', 'JP': '🇯🇵', 'SG': '🇸🇬',
  'CA': '🇨🇦', 'AU': '🇦🇺', 'TR': '🇹🇷', 'PL': '🇵🇱', 'UA': '🇺🇦',
  'KZ': '🇰🇿', 'LV': '🇱🇻', 'EE': '🇪🇪', 'LT': '🇱🇹', 'CZ': '🇨🇿',
  'AT': '🇦🇹', 'CH': '🇨🇭', 'IT': '🇮🇹', 'ES': '🇪🇸', 'BR': '🇧🇷',
  'IN': '🇮🇳', 'CN': '🇨🇳', 'HK': '🇭🇰', 'KR': '🇰🇷', 'IL': '🇮🇱',
  'AE': '🇦🇪', 'IE': '🇮🇪', 'BE': '🇧🇪', 'RO': '🇷🇴', 'BG': '🇧🇬',
  'HU': '🇭🇺', 'RS': '🇷🇸', 'MD': '🇲🇩', 'GE': '🇬🇪', 'AM': '🇦🇲',
  'AZ': '🇦🇿', 'BY': '🇧🇾', 'MX': '🇲🇽', 'AR': '🇦🇷'
};

// Preload flag image
function preloadFlag(code) {
  if (flagCache.has(code)) return flagCache.get(code);
  
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      flagCache.set(code, { loaded: true, url: img.src });
      resolve({ loaded: true, url: img.src });
    };
    img.onerror = () => {
      flagCache.set(code, { loaded: false });
      resolve({ loaded: false });
    };
    img.src = `${FLAG_CDN}/${code.toLowerCase()}.png`;
  });
  
  flagCache.set(code, promise);
  return promise;
}

// Preload all flags at startup
async function preloadAllFlags() {
  const codes = Object.values(COUNTRY_MAP);
  const uniqueCodes = [...new Set(codes)];
  await Promise.all(uniqueCodes.map(code => preloadFlag(code)));
}

// Get flag HTML with fallback
function codeToFlag(code) {
  const cached = flagCache.get(code);
  
  // If cached and loaded, use image
  if (cached && cached.loaded) {
    return `<img src="${cached.url}" alt="${code}" class="flag-img" onerror="this.outerHTML='${EMOJI_FLAGS[code] || '🌐'}'">`;
  }
  
  // If cached but failed, use emoji
  if (cached && cached.loaded === false) {
    return `<span class="flag-emoji">${EMOJI_FLAGS[code] || '🌐'}</span>`;
  }
  
  // Not cached yet - use image with onerror fallback
  return `<img src="${FLAG_CDN}/${code.toLowerCase()}.png" alt="${code}" class="flag-img" onerror="this.outerHTML='<span class=\\'flag-emoji\\'>${EMOJI_FLAGS[code] || '🌐'}</span>'">`;
}

const COUNTRY_MAP = {
  'russia': 'RU', 'moscow': 'RU', 'spb': 'RU', 'росси': 'RU', 'novosibirsk': 'RU', 'ekb': 'RU',
  'sweden': 'SE', 'stockholm': 'SE', 'швец': 'SE',
  'finland': 'FI', 'helsinki': 'FI', 'финлянд': 'FI',
  'netherlands': 'NL', 'amsterdam': 'NL', 'голланд': 'NL', 'нидерланд': 'NL',
  'germany': 'DE', 'frankfurt': 'DE', 'герман': 'DE',
  'usa': 'US', 'america': 'US', 'new york': 'US', 'chicago': 'US', 'dallas': 'US', 'los angeles': 'US', 'сша': 'US',
  'uk': 'GB', 'london': 'GB', 'england': 'GB', 'британ': 'GB', 'англ': 'GB',
  'france': 'FR', 'paris': 'FR', 'франц': 'FR', 'gravelines': 'FR',
  'japan': 'JP', 'tokyo': 'JP', 'япон': 'JP',
  'singapore': 'SG', 'сингапур': 'SG',
  'canada': 'CA', 'канад': 'CA',
  'australia': 'AU', 'австрал': 'AU',
  'turkey': 'TR', 'istanbul': 'TR', 'stambul': 'TR', 'турц': 'TR',
  'poland': 'PL', 'warsaw': 'PL', 'польш': 'PL',
  'ukraine': 'UA', 'украин': 'UA', 'киев': 'UA',
  'kazakhstan': 'KZ', 'astana': 'KZ', 'казах': 'KZ',
  'latvia': 'LV', 'латв': 'LV', 'riga': 'LV',
  'estonia': 'EE', 'эстон': 'EE', 'tallinn': 'EE',
  'lithuania': 'LT', 'литв': 'LT', 'vilnius': 'LT',
  'czech': 'CZ', 'prague': 'CZ', 'чех': 'CZ',
  'austria': 'AT', 'vienna': 'AT',
  'switzerland': 'CH', 'swiss': 'CH', 'швейцар': 'CH',
  'italy': 'IT', 'milan': 'IT', 'rome': 'IT', 'итал': 'IT',
  'spain': 'ES', 'madrid': 'ES', 'испан': 'ES',
  'brazil': 'BR', 'бразил': 'BR',
  'india': 'IN', 'mumbai': 'IN', 'инди': 'IN',
  'china': 'CN', 'кита': 'CN',
  'hong kong': 'HK',
  'korea': 'KR', 'seoul': 'KR', 'коре': 'KR',
  'israel': 'IL', 'израил': 'IL',
  'uae': 'AE', 'dubai': 'AE', 'оаэ': 'AE', 'дубай': 'AE',
  'ireland': 'IE', 'dublin': 'IE', 'ирланд': 'IE',
  'belgium': 'BE', 'бельг': 'BE',
  'romania': 'RO', 'румын': 'RO',
  'bulgaria': 'BG', 'болгар': 'BG',
  'hungary': 'HU', 'венгр': 'HU',
  'serbia': 'RS', 'серб': 'RS',
  'moldova': 'MD', 'молдов': 'MD',
  'georgia': 'GE', 'грузи': 'GE', 'tbilisi': 'GE',
  'armenia': 'AM', 'армен': 'AM',
  'azerbaijan': 'AZ', 'азербайджан': 'AZ',
  'belarus': 'BY', 'белорус': 'BY', 'беларус': 'BY',
  'mexico': 'MX', 'мексик': 'MX',
  'argentina': 'AR', 'аргентин': 'AR'
};

document.addEventListener('DOMContentLoaded', async () => {
  // Start preloading flags immediately
  preloadAllFlags();
  
  await loadData();
  setupNavigation();
  setupSearch();
  loadAboutInfo();
  loadSettings();
});

async function loadData() {
  servers = await ipcRenderer.invoke('get-servers');
  subscriptions = await ipcRenderer.invoke('get-subscriptions');
  const status = await ipcRenderer.invoke('get-status');
  isConnected = status.connected;
  
  if (status.server) {
    selectedServer = status.server;
  } else {
    // Load last selected server
    const lastServerId = await ipcRenderer.invoke('get-last-server');
    if (lastServerId) {
      selectedServer = servers.find(s => s.id === lastServerId) || null;
    }
  }
  
  // Load saved connection mode
  const savedMode = await ipcRenderer.invoke('get-connection-mode');
  tunMode = (savedMode === 'tun');
  updateModeButtons();
  
  renderSubscriptions();
  updateConnectPanel();
}

function updateModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (tunMode) {
    document.querySelector('.mode-btn.tun').classList.add('active');
  } else {
    document.querySelector('.mode-btn:not(.tun)').classList.add('active');
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(item.dataset.page + '-page').classList.add('active');
    });
  });
}

function setupSearch() {
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll('.server-item').forEach(item => {
      const name = item.querySelector('.server-name').textContent.toLowerCase();
      item.style.display = name.includes(query) ? 'flex' : 'none';
    });
  });
}

function getFlag(name) {
  const lower = name.toLowerCase();
  
  // First try to find country in map
  for (const [key, code] of Object.entries(COUNTRY_MAP)) {
    if (lower.includes(key)) {
      return codeToFlag(code);
    }
  }
  
  // Try to extract 2-letter code from name like "RU Russia" or "🇷🇺 Russia"
  const codeMatch = lower.match(/\b([a-z]{2})\b/);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    // Check if it's a valid country code
    if (['RU','SE','FI','NL','DE','US','GB','FR','JP','SG','CA','AU','TR','PL','UA','KZ','LV','EE','LT'].includes(code)) {
      return codeToFlag(code);
    }
  }
  
  return `<span style="font-size:18px;">🌐</span>`;
}

function getCountryCode(name) {
  // Return emoji flag instead of code
  return getFlag(name);
}


function renderSubscriptions() {
  const container = document.getElementById('subscriptionsList');
  
  if (subscriptions.length === 0 && servers.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
        <p style="font-size:14px;margin-bottom:8px;">Нет подписок</p>
        <p style="font-size:12px;">Нажмите + чтобы добавить</p>
      </div>
    `;
    return;
  }

  let html = '';
  
  subscriptions.forEach(sub => {
    const subServers = servers.filter(s => s.subId === sub.id);
    const safeName = escapeHtml(sub.name || 'Подписка');
    
    html += `
      <div class="subscription-card expanded" data-id="${sub.id}">
        <div class="sub-header" onclick="toggleSub('${sub.id}')">
          <div class="sub-title">
            <span class="arrow">›</span>
            <span class="sub-name">${safeName}</span>
            <span class="sub-meta">${subServers.length} серверов</span>
          </div>
          <div class="sub-actions">
            <button onclick="event.stopPropagation(); updateSub('${sub.id}')" title="Обновить">↻</button>
            <button onclick="event.stopPropagation(); deleteSub('${sub.id}')" title="Удалить">×</button>
          </div>
        </div>
        <div class="server-list">
          ${renderServers(subServers)}
        </div>
      </div>
    `;
  });

  const freeServers = servers.filter(s => !s.subId);
  if (freeServers.length > 0) {
    html += `
      <div class="subscription-card expanded">
        <div class="sub-header">
          <div class="sub-title">
            <span class="arrow">›</span>
            <span class="sub-name">Вручную</span>
            <span class="sub-meta">${freeServers.length} серверов</span>
          </div>
        </div>
        <div class="server-list">
          ${renderServers(freeServers)}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Escape HTML to prevent XSS and display special characters correctly
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderServers(serverList) {
  return serverList.map(s => {
    const flag = getFlag(s.name);
    const selected = selectedServer && selectedServer.id === s.id ? 'selected' : '';
    const network = s.network || 'tcp';
    const protocol = (s.type || 'vless').toUpperCase();
    const safeName = escapeHtml(s.name);
    
    return `
      <div class="server-item ${selected}" onclick="selectServer('${s.id}')">
        <div class="server-flag">${flag}</div>
        <div class="server-info">
          <div class="server-name">${safeName}</div>
          <div class="server-type">${protocol} • ${network.toUpperCase()}</div>
        </div>
        <span class="server-arrow">›</span>
      </div>
    `;
  }).join('');
}

function toggleSub(id) {
  const card = document.querySelector(`.subscription-card[data-id="${id}"]`);
  if (card) card.classList.toggle('expanded');
}

let currentConnectedServerId = null;

async function selectServer(id) {
  const previousServer = selectedServer;
  selectedServer = servers.find(s => s.id === id);
  
  // Update selection without re-rendering (preserve scroll position)
  document.querySelectorAll('.server-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // Find and select the clicked item
  const clickedItem = document.querySelector(`.server-item[onclick*="'${id}'"]`);
  if (clickedItem) {
    clickedItem.classList.add('selected');
  }
  
  updateConnectPanel();
  
  // Auto-reconnect if connected and server changed
  if (isConnected && previousServer && previousServer.id !== id) {
    showToast('info', 'Переподключение', `Переключение на ${selectedServer.name}...`);
    await reconnect();
  }
}

function updateConnectPanel() {
  const circle = document.getElementById('connectCircle');
  const panel = document.getElementById('connectPanel');
  const flag = document.getElementById('selectedFlag');
  const name = document.getElementById('selectedName');
  const statusText = document.getElementById('statusText');
  
  if (isConnected) {
    circle.classList.add('connected');
    panel.classList.add('connected');
    statusText.textContent = 'Подключено';
    startTimer();
  } else {
    circle.classList.remove('connected');
    panel.classList.remove('connected');
    statusText.textContent = 'Отключено';
    stopTimer();
  }
  
  if (selectedServer) {
    flag.innerHTML = getCountryCode(selectedServer.name);
    name.textContent = selectedServer.name;
  } else {
    flag.innerHTML = '—';
    name.textContent = 'Выберите сервер';
  }
}

function startTimer() {
  if (connectionTimer) return;
  connectionStartTime = Date.now();
  connectionTimer = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopTimer() {
  if (connectionTimer) {
    clearInterval(connectionTimer);
    connectionTimer = null;
  }
  document.getElementById('statusTimer').textContent = '00:00:00';
}

function updateTimer() {
  if (!connectionStartTime) return;
  const elapsed = Math.floor((Date.now() - connectionStartTime) / 1000);
  const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('statusTimer').textContent = `${h}:${m}:${s}`;
}


let tunMode = false;

async function toggleConnection() {
  if (isConnected) {
    await ipcRenderer.invoke('disconnect');
    isConnected = false;
    currentConnectedServerId = null;
  } else if (selectedServer) {
    document.getElementById('statusText').textContent = tunMode ? 'Создание TUN...' : 'Подключение...';
    try {
      await ipcRenderer.invoke('connect', selectedServer.id, tunMode);
      isConnected = true;
      currentConnectedServerId = selectedServer.id;
    } catch (e) {
      showToast('error', 'Ошибка подключения', e.message);
    }
  } else {
    showToast('info', 'Выберите сервер', 'Сначала выберите сервер из списка');
    return;
  }
  updateConnectPanel();
}

async function setMode(mode) {
  const previousMode = tunMode;
  tunMode = (mode === 'tun');
  
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (tunMode) {
    document.querySelector('.mode-btn.tun').classList.add('active');
  } else {
    document.querySelector('.mode-btn:not(.tun)').classList.add('active');
  }
  
  // Auto-reconnect if connected and mode changed
  if (isConnected && previousMode !== tunMode) {
    showToast('info', 'Переподключение', `Переключение на ${tunMode ? 'TUN' : 'Proxy'} режим...`);
    await reconnect();
  }
}

async function reconnect() {
  if (!selectedServer) return;
  
  document.getElementById('statusText').textContent = 'Переподключение...';
  
  try {
    await ipcRenderer.invoke('disconnect');
    await ipcRenderer.invoke('connect', selectedServer.id, tunMode);
    isConnected = true;
    currentConnectedServerId = selectedServer.id;
  } catch (e) {
    showToast('error', 'Ошибка', e.message);
    isConnected = false;
  }
  
  updateConnectPanel();
}

async function testPing() {
  if (!selectedServer) {
    showToast('info', 'Выберите сервер', 'Сначала выберите сервер для тестирования');
    return;
  }
  
  const btn = document.querySelector('.action-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Тестирование...';
  btn.disabled = true;
  
  try {
    const result = await ipcRenderer.invoke('test-ping', selectedServer);
    if (result.success) {
      showToast('success', selectedServer.name, `Пинг: ${result.ping} мс`);
    } else {
      showToast('error', selectedServer.name, result.error);
    }
  } catch (e) {
    showToast('error', 'Ошибка', e.message);
  }
  
  btn.textContent = originalText;
  btn.disabled = false;
}

// Subscription management
function showAddSubModal() {
  document.getElementById('addSubModal').classList.remove('hidden');
  document.getElementById('subUrlInput').focus();
}

function hideAddSubModal() {
  document.getElementById('addSubModal').classList.add('hidden');
  document.getElementById('subUrlInput').value = '';
  document.getElementById('subNameInput').value = '';
}

async function addSubscription() {
  const url = document.getElementById('subUrlInput').value.trim();
  const name = document.getElementById('subNameInput').value.trim();
  
  if (!url) {
    showToast('info', 'Введите ссылку', 'Укажите ссылку на подписку');
    return;
  }
  
  // Show loading toast
  const loadingToast = showToast('info', 'Загрузка подписки', 'Получение списка серверов...', 30000);
  
  try {
    await ipcRenderer.invoke('add-subscription', url, name);
    loadingToast.remove();
    hideAddSubModal();
    showToast('success', 'Подписка добавлена', 'Серверы успешно загружены');
    await loadData();
  } catch (e) {
    loadingToast.remove();
    showToast('error', 'Ошибка добавления', e.message);
  }
}

async function updateSub(id) {
  const btn = event.target;
  btn.textContent = '...';
  btn.disabled = true;
  
  await ipcRenderer.invoke('update-subscription', id);
  await loadData();
  
  btn.textContent = '↻';
  btn.disabled = false;
}

async function deleteSub(id) {
  if (confirm('Удалить подписку и все её серверы?')) {
    await ipcRenderer.invoke('remove-subscription', id);
    await loadData();
  }
}

// IPC listeners - status-changed is handled below with IP refresh

ipcRenderer.on('servers-updated', async () => {
  await loadData();
});

ipcRenderer.on('subscription-error', (_, message) => {
  showToast('error', 'Ошибка подписки', message);
});

// Handle deep link subscription add
ipcRenderer.on('add-subscription-url', async (_, url) => {
  const loadingToast = showToast('info', 'Добавление подписки', 'Получение списка серверов...', 30000);
  try {
    await ipcRenderer.invoke('add-subscription', url, '');
    loadingToast.remove();
    showToast('success', 'Подписка добавлена', 'Серверы успешно загружены');
    await loadData();
  } catch (e) {
    loadingToast.remove();
    showToast('error', 'Ошибка добавления', e.message);
  }
});

// Download progress handler
ipcRenderer.on('download-progress', (_, progress) => {
  showDownloadProgress(progress);
});

function showDownloadProgress(progress) {
  const overlay = document.getElementById('downloadOverlay');
  const title = document.getElementById('downloadTitle');
  const status = document.getElementById('downloadStatus');
  const fill = document.getElementById('downloadProgressFill');
  const percent = document.getElementById('downloadPercent');
  
  overlay.classList.remove('hidden');
  
  const titles = {
    'xray': 'Загрузка Xray Core',
    'singbox': 'Загрузка sing-box',
    'wintun': 'Загрузка WinTUN'
  };
  
  title.textContent = titles[progress.type] || 'Загрузка компонентов';
  status.textContent = progress.status;
  fill.style.width = progress.percent + '%';
  percent.textContent = progress.percent + '%';
  
  // Hide after completion
  if (progress.percent === 100 && progress.status.includes('готов')) {
    setTimeout(() => {
      hideDownloadOverlay();
    }, 1000);
  }
}

function hideDownloadOverlay() {
  const overlay = document.getElementById('downloadOverlay');
  overlay.classList.add('hidden');
}

// Window controls
function windowMinimize() {
  ipcRenderer.send('window-minimize');
}

function windowMaximize() {
  ipcRenderer.send('window-maximize');
}

function windowClose() {
  ipcRenderer.send('window-close');
}

// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideAddSubModal();
  }
});

// About page functions
let appHwid = '';

async function loadAboutInfo() {
  try {
    const info = await ipcRenderer.invoke('get-app-info');
    document.getElementById('appVersion').textContent = `v${info.appVersion}`;
    document.getElementById('aboutElectronVersion').textContent = info.electronVersion;
    document.getElementById('aboutNodeVersion').textContent = info.nodeVersion;
    document.getElementById('aboutPlatform').textContent = info.platform;
    document.getElementById('aboutHwid').textContent = info.hwid;
    appHwid = info.hwid;
    
    // Load core versions
    const cores = await ipcRenderer.invoke('get-core-versions');
    document.getElementById('aboutXrayVersion').textContent = cores.xrayVersion;
    document.getElementById('aboutSingboxVersion').textContent = cores.singboxVersion;
  } catch (e) {
    console.error('Failed to load about info:', e);
  }
}

function copyHwid() {
  if (appHwid) {
    navigator.clipboard.writeText(appHwid);
    showToast('success', 'Скопировано', 'HWID скопирован в буфер обмена');
  }
}

function openWebsite() {
  require('electron').shell.openExternal('https://sientel.com');
}

function openTelegram() {
  require('electron').shell.openExternal('https://t.me/sientel');
}

function checkUpdates() {
  showToast('info', 'Проверка обновлений', 'У вас установлена последняя версия');
}

// Settings functions
async function loadSettings() {
  const autoConnect = await ipcRenderer.invoke('get-auto-connect');
  const startWithWindows = await ipcRenderer.invoke('get-start-with-windows');
  const disconnectOnGame = await ipcRenderer.invoke('get-disconnect-on-game');
  
  document.getElementById('autoConnect').checked = autoConnect;
  document.getElementById('startWithWindows').checked = startWithWindows;
  document.getElementById('disconnectOnGame').checked = disconnectOnGame;
  
  // Add event listeners
  document.getElementById('autoConnect').addEventListener('change', async (e) => {
    await ipcRenderer.invoke('set-auto-connect', e.target.checked);
    if (e.target.checked) {
      showToast('success', 'Автоподключение', 'Включено');
    }
  });
  
  document.getElementById('startWithWindows').addEventListener('change', async (e) => {
    await ipcRenderer.invoke('set-start-with-windows', e.target.checked);
    if (e.target.checked) {
      showToast('success', 'Автозапуск', 'Sientel будет запускаться с Windows');
    }
  });
  
  document.getElementById('disconnectOnGame').addEventListener('change', async (e) => {
    await ipcRenderer.invoke('set-disconnect-on-game', e.target.checked);
    if (e.target.checked) {
      showToast('success', 'Режим игр', 'VPN отключится при запуске игры');
    }
  });
}

// Game detection listeners
ipcRenderer.on('game-detected', () => {
  showToast('info', 'Игра обнаружена', 'VPN отключен для лучшего пинга');
});

ipcRenderer.on('game-closed', () => {
  showToast('success', 'Игра закрыта', 'VPN подключен обратно');
});

// IP functions
let realIP = null;

async function refreshIP() {
  const btn = document.querySelector('.ip-refresh');
  const indicator = document.getElementById('ipIndicator');
  const label = document.getElementById('ipLabel');
  const value = document.getElementById('ipValue');
  
  btn.classList.add('loading');
  value.textContent = 'Загрузка...';
  
  try {
    const result = await ipcRenderer.invoke('get-ip');
    
    if (result.success) {
      value.textContent = result.ip;
      
      if (isConnected) {
        // Connected - check if IP changed
        if (realIP && result.ip !== realIP) {
          indicator.className = 'ip-indicator protected';
          label.textContent = 'Защищён';
        } else {
          indicator.className = 'ip-indicator protected';
          label.textContent = 'VPN IP';
        }
      } else {
        // Not connected - save real IP
        realIP = result.ip;
        indicator.className = 'ip-indicator exposed';
        label.textContent = 'Ваш IP';
      }
    } else {
      value.textContent = 'Ошибка';
      indicator.className = 'ip-indicator';
      label.textContent = 'IP';
    }
  } catch (e) {
    value.textContent = 'Ошибка';
  }
  
  btn.classList.remove('loading');
}

// Refresh IP on connection status change
ipcRenderer.on('status-changed', async (_, data) => {
  isConnected = data.connected;
  if (data.server) selectedServer = data.server;
  updateConnectPanel();
  hideDownloadOverlay();
  
  // Refresh IP after connection change
  setTimeout(refreshIP, 1000);
});

// Initial IP load
setTimeout(refreshIP, 1500);
