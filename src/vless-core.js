const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { downloadXray, downloadSingbox, downloadWintun } = require('./vless-core-downloads');

class VlessCore {
  constructor() {
    this.connected = false;
    this.currentServer = null;
    this.coreProcess = null;
    this.socksPort = 10808;
    this.httpPort = 10809;
    this.tunMode = false;
    this.isLinux = process.platform === 'linux';
    this.isWindows = process.platform === 'win32';
    
    // Platform-specific paths
    const configDir = this.isWindows 
      ? path.join(process.env.APPDATA, '.sientel-client')
      : path.join(process.env.HOME, '.config', 'sientel-client');
    
    this.configPath = configDir;
    this.xrayPath = path.join(this.configPath, this.isWindows ? 'xray.exe' : 'xray');
    this.singboxPath = path.join(this.configPath, this.isWindows ? 'sing-box.exe' : 'sing-box');
    this.wintunPath = path.join(this.configPath, 'wintun.dll'); // Windows only
    this.configFile = path.join(this.configPath, 'config.json');
    this.onProgress = null; // Callback for download progress
    
    // Cleanup stale interfaces on Linux
    if (this.isLinux) {
      this.cleanupStaleInterfaces().catch(e => console.error('Cleanup failed:', e));
    }
  }

  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  emitProgress(type, percent, status) {
    if (this.onProgress) {
      this.onProgress({ type, percent, status });
    }
  }

  // Check if protocol requires sing-box (not supported by Xray)
  needsSingbox(server) {
    const singboxOnlyProtocols = ['hysteria', 'hysteria2', 'tuic', 'shadowsocksr'];
    return singboxOnlyProtocols.includes(server.type);
  }

  async checkTunCapabilities() {
    if (!this.isLinux) return { ok: true };
    
    // Check if running as root
    try {
      const { stdout } = await execAsync('id -u');
      if (stdout.trim() === '0') {
        return { ok: true, method: 'root' };
      }
    } catch {}
    
    // Check if sing-box has capabilities
    try {
      const { stdout } = await execAsync(`getcap "${this.singboxPath}" 2>/dev/null || echo ""`);
      if (stdout.includes('cap_net_admin+ep')) {
        return { ok: true, method: 'capabilities' };
      }
    } catch {}
    
    // Check if pkexec is available (will use it to run sing-box)
    try {
      await execAsync('which pkexec 2>/dev/null');
      return { ok: true, method: 'pkexec' };
    } catch {}
    
    return {
      ok: false,
      error: 'TUN mode requires root privileges',
      help: `Install polkit: sudo pacman -S polkit\nOr run with: sudo ${process.argv[0]}`
    };
  }

  async connect(server, tunMode = false) {
    if (this.connected) await this.disconnect();
    
    this.currentServer = server;
    this.tunMode = tunMode;
    const useSingbox = this.needsSingbox(server);
    
    console.log('Connecting to:', server.name);
    console.log('Address:', server.address, 'Port:', server.port);
    console.log('Type:', server.type, 'Network:', server.network, 'Security:', server.security);
    console.log('TUN mode:', tunMode, 'Use sing-box:', useSingbox);
    console.log('Platform:', this.isLinux ? 'Linux' : 'Windows');
    
    try {
      if (!fs.existsSync(this.configPath)) {
        fs.mkdirSync(this.configPath, { recursive: true });
      }

      // Check TUN capabilities on Linux
      if (tunMode && this.isLinux) {
        const capCheck = await this.checkTunCapabilities();
        if (!capCheck.ok) {
          throw new Error(`${capCheck.error}\n\n${capCheck.help}`);
        }
        console.log(`TUN capabilities OK (${capCheck.method})`);
      }

      // Save original routes before TUN mode
      if (tunMode && this.isLinux) {
        await this.saveOriginalRoutes();
      }

      // Protocols like Hysteria2/TUIC need sing-box
      if (useSingbox) {
        if (!fs.existsSync(this.singboxPath)) {
          console.log('sing-box not found, downloading...');
          await this.downloadSingbox();
        }
        if (tunMode && this.isWindows && !fs.existsSync(this.wintunPath)) {
          console.log('wintun not found, downloading...');
          await this.downloadWintun();
        }
        await this.startSingboxDirect(server, tunMode);
        if (!tunMode) {
          await this.setSystemProxy(true);
        }
      } else if (tunMode) {
        // TUN mode: Xray (SOCKS proxy) + sing-box (TUN interface)
        if (!fs.existsSync(this.xrayPath)) {
          console.log('Xray not found, downloading...');
          await this.downloadXray();
        }
        if (!fs.existsSync(this.singboxPath)) {
          console.log('sing-box not found, downloading...');
          await this.downloadSingbox();
        }
        if (this.isWindows && !fs.existsSync(this.wintunPath)) {
          console.log('wintun not found, downloading...');
          await this.downloadWintun();
        }
        // First start Xray as SOCKS proxy
        await this.startXray(server);
        // Then start sing-box TUN that routes through Xray
        await this.startSingboxTun(server);
      } else {
        // Proxy mode uses xray
        if (!fs.existsSync(this.xrayPath)) {
          console.log('Xray not found, downloading...');
          await this.downloadXray();
        }
        await this.startXray(server);
        await this.setSystemProxy(true);
      }
      
      this.connected = true;
      console.log('Connected successfully');
      return true;
    } catch (e) {
      console.error('Connection failed:', e);
      await this.disconnect();
      throw e;
    }
  }

  async startXray(server) {
    const config = this.generateXrayConfig(server);
    fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2));
    console.log('Config written to:', this.configFile);
    
    // Make executable on Linux
    if (this.isLinux) {
      try {
        fs.chmodSync(this.xrayPath, 0o755);
      } catch (e) {
        console.log('chmod failed:', e.message);
      }
    }
    
    return new Promise((resolve, reject) => {
      const spawnOptions = this.isWindows 
        ? { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        : { stdio: ['ignore', 'pipe', 'pipe'] };
      
      this.coreProcess = spawn(this.xrayPath, ['run', '-c', this.configFile], spawnOptions);
      
      let started = false;
      
      this.coreProcess.stdout.on('data', (data) => {
        console.log('xray:', data.toString().trim());
      });
      
      this.coreProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        console.log('xray:', msg.trim());
        if (msg.includes('started') || msg.includes('Xray')) {
          if (!started) {
            started = true;
            setTimeout(resolve, 500);
          }
        }
      });
      
      this.coreProcess.on('error', (err) => {
        console.error('xray process error:', err);
        reject(err);
      });
      
      this.coreProcess.on('exit', (code) => {
        console.log('xray exited with code:', code);
        if (!started) reject(new Error(`xray exited with code ${code}`));
      });
      
      // Wait and verify ports are listening
      setTimeout(async () => {
        if (!started) {
          try {
            // Check if ports are listening
            const checkPort = async (port) => {
              try {
                const { stdout } = await execAsync(`ss -tuln | grep :${port} || netstat -tuln | grep :${port} || lsof -i :${port}`);
                return stdout.includes(`:${port}`);
              } catch {
                return false;
              }
            };
            
            const socksOk = await checkPort(this.socksPort);
            const httpOk = await checkPort(this.httpPort);
            
            if (socksOk || httpOk) {
              console.log(`✓ Xray listening on ports: SOCKS=${socksOk}, HTTP=${httpOk}`);
              started = true;
              resolve();
            } else {
              console.error('✗ Xray ports not listening');
              reject(new Error('Xray failed to start - ports not listening'));
            }
          } catch (e) {
            console.error('Port check failed:', e);
            started = true;
            resolve(); // Fallback to assuming it started
          }
        }
      }, 2000);
    });
  }


  generateXrayConfig(server) {
    let outbound;
    const serverType = server.type || 'vless';
    
    // Build outbound based on protocol type
    if (serverType === 'vless') {
      outbound = {
        mux: { concurrency: -1, enabled: false, xudpConcurrency: 8, xudpProxyUDP443: '' },
        protocol: 'vless',
        settings: {
          vnext: [{
            address: server.address,
            port: server.port,
            users: [{
              encryption: 'none',
              id: server.uuid,
              level: 8,
              security: 'auto',
              flow: server.flow || ''
            }]
          }]
        },
        streamSettings: {
          network: server.network || 'tcp',
          security: server.security || 'none'
        },
        tag: 'proxy'
      };
    } else if (serverType === 'vmess') {
      outbound = {
        mux: { concurrency: -1, enabled: false },
        protocol: 'vmess',
        settings: {
          vnext: [{
            address: server.address,
            port: server.port,
            users: [{
              id: server.uuid,
              alterId: server.alterId || 0,
              security: 'auto',
              level: 8
            }]
          }]
        },
        streamSettings: {
          network: server.network || 'tcp',
          security: server.security || 'none'
        },
        tag: 'proxy'
      };
    } else if (serverType === 'trojan') {
      outbound = {
        mux: { concurrency: -1, enabled: false },
        protocol: 'trojan',
        settings: {
          servers: [{
            address: server.address,
            port: server.port,
            password: server.password,
            level: 8
          }]
        },
        streamSettings: {
          network: server.network || 'tcp',
          security: server.security || 'tls'
        },
        tag: 'proxy'
      };
    } else if (serverType === 'shadowsocks') {
      outbound = {
        protocol: 'shadowsocks',
        settings: {
          servers: [{
            address: server.address,
            port: server.port,
            method: server.method || 'aes-256-gcm',
            password: server.password,
            level: 8
          }]
        },
        tag: 'proxy'
      };
    } else if (serverType === 'socks') {
      outbound = {
        protocol: 'socks',
        settings: {
          servers: [{
            address: server.address,
            port: server.port,
            users: server.username ? [{
              user: server.username,
              pass: server.password || ''
            }] : []
          }]
        },
        tag: 'proxy'
      };
    } else {
      // Default to VLESS
      outbound = {
        protocol: 'vless',
        settings: {
          vnext: [{
            address: server.address,
            port: server.port,
            users: [{ id: server.uuid, encryption: 'none' }]
          }]
        },
        streamSettings: { network: 'tcp', security: 'none' },
        tag: 'proxy'
      };
    }
    
    // Add stream settings for protocols that support it
    if (!outbound.streamSettings && (serverType === 'vless' || serverType === 'vmess' || serverType === 'trojan')) {
      outbound.streamSettings = {
        network: server.network || 'tcp',
        security: server.security || 'none'
      };
    }

    // Add security settings if streamSettings exists
    if (outbound.streamSettings) {
      // Reality settings
      if (server.security === 'reality') {
        outbound.streamSettings.realitySettings = {
          allowInsecure: false,
          fingerprint: server.fp || 'chrome',
          publicKey: server.pbk || '',
          serverName: server.sni || server.address,
          shortId: server.sid || '',
          show: false,
          spiderX: ''
        };
      }

      // TLS settings
      if (server.security === 'tls') {
        outbound.streamSettings.tlsSettings = {
          allowInsecure: true,
          fingerprint: server.fp || 'chrome',
          serverName: server.sni || server.address
        };
      }
    }

    // Network specific settings (only for protocols with streamSettings)
    if (outbound.streamSettings) {
      if (server.network === 'xhttp' || server.network === 'splithttp') {
        outbound.streamSettings.network = 'xhttp';
        outbound.streamSettings.xhttpSettings = {
          host: server.host || '',
          mode: 'packet-up',
          path: server.path || '/',
          scMaxConcurrentPosts: 10,
          scMaxEachPostBytes: 1000000,
          scMinPostsIntervalMs: 30
        };
      } else if (server.network === 'ws') {
        outbound.streamSettings.wsSettings = {
          path: server.path || '/',
          headers: { Host: server.host || server.address }
        };
      } else if (server.network === 'grpc') {
        outbound.streamSettings.grpcSettings = {
          serviceName: server.serviceName || server.path || '',
          multiMode: server.grpcMode === 'multi',
          idle_timeout: 60,
          health_check_timeout: 20,
          permit_without_stream: false
        };
      } else if (server.network === 'tcp') {
        outbound.streamSettings.tcpSettings = {};
      }
    }

    return {
      dns: {
        hosts: { 'domain:googleapis.cn': 'googleapis.com' },
        queryStrategy: 'UseIPv4',
        servers: [
          '1.1.1.1',
          { address: '1.1.1.1', domains: [], port: 53 },
          { address: '8.8.8.8', domains: [], port: 53 }
        ]
      },
      inbounds: [
        {
          listen: '127.0.0.1',
          port: this.socksPort,
          protocol: 'socks',
          settings: { auth: 'noauth', udp: true, userLevel: 8 },
          sniffing: { destOverride: ['http', 'tls', 'quic'], enabled: true },
          tag: 'socks'
        },
        {
          listen: '127.0.0.1',
          port: this.httpPort,
          protocol: 'http',
          settings: { userLevel: 8 },
          sniffing: { destOverride: ['http', 'tls', 'quic'], enabled: true },
          tag: 'http'
        }
      ],
      log: { loglevel: 'warning' },
      outbounds: [
        outbound,
        { protocol: 'freedom', settings: { domainStrategy: 'UseIP' }, tag: 'direct' },
        { protocol: 'blackhole', settings: { response: { type: 'http' } }, tag: 'block' }
      ],
      routing: {
        domainStrategy: 'IPIfNonMatch',
        rules: [
          { ip: ['1.1.1.1'], outboundTag: 'proxy', port: '53' },
          { ip: ['8.8.8.8'], outboundTag: 'direct', port: '53' }
        ]
      }
    };
  }


  async disconnect() {
    if (this.coreProcess) {
      this.coreProcess.kill('SIGTERM');
      // Wait for graceful shutdown
      await new Promise(r => setTimeout(r, 1000));
      if (this.coreProcess && !this.coreProcess.killed) {
        this.coreProcess.kill('SIGKILL');
      }
      this.coreProcess = null;
    }
    
    try {
      if (this.isWindows) {
        await execAsync('taskkill /F /IM xray.exe 2>nul');
        await execAsync('taskkill /F /IM sing-box.exe 2>nul');
      } else {
        await execAsync('pkill -TERM xray 2>/dev/null || true');
        await execAsync('pkill -TERM sing-box 2>/dev/null || true');
        await new Promise(r => setTimeout(r, 500));
        await execAsync('pkill -9 xray 2>/dev/null || true');
        await execAsync('pkill -9 sing-box 2>/dev/null || true');
      }
    } catch {}
    
    // Cleanup TUN interface and routes on Linux
    if (this.tunMode && this.isLinux) {
      await this.cleanupTunInterface();
      await this.restoreOriginalRoutes();
    }
    
    if (!this.tunMode) {
      await this.setSystemProxy(false);
    }
    
    this.connected = false;
    this.currentServer = null;
    this.tunMode = false;
    console.log('Disconnected');
  }

  async cleanupStaleInterfaces() {
    if (!this.isLinux) return;
    
    try {
      // Check for zombie TUN interface
      const { stdout } = await execAsync('ip link show sientel-tun 2>/dev/null || echo ""');
      if (stdout.includes('sientel-tun')) {
        console.log('Found stale TUN interface, cleaning up...');
        await execAsync('ip link delete sientel-tun 2>/dev/null || true');
      }
      
      // Restore original routes if saved
      await this.restoreOriginalRoutes();
    } catch (e) {
      console.error('Stale interface cleanup failed:', e.message);
    }
  }

  async cleanupTunInterface() {
    if (!this.isLinux) return;
    
    try {
      await execAsync('ip link delete sientel-tun 2>/dev/null || true');
      console.log('TUN interface cleaned up');
    } catch (e) {
      console.error('TUN cleanup failed:', e.message);
    }
  }

  async saveOriginalRoutes() {
    if (!this.isLinux) return;
    
    try {
      const { stdout } = await execAsync('ip route show default');
      if (stdout.trim()) {
        this.originalDefaultRoute = stdout.trim();
        const routeFile = path.join(this.configPath, 'original-route.txt');
        fs.writeFileSync(routeFile, this.originalDefaultRoute);
        console.log('Saved original route:', this.originalDefaultRoute);
      }
    } catch (e) {
      console.error('Failed to save routes:', e.message);
    }
  }

  async restoreOriginalRoutes() {
    if (!this.isLinux) return;
    
    try {
      const routeFile = path.join(this.configPath, 'original-route.txt');
      if (fs.existsSync(routeFile)) {
        const route = fs.readFileSync(routeFile, 'utf8').trim();
        if (route) {
          // Remove TUN route if exists
          await execAsync('ip route del default dev sientel-tun 2>/dev/null || true');
          // Restore original (only if not already present)
          const { stdout } = await execAsync('ip route show default');
          if (!stdout.includes(route.split(' ')[2])) { // Check gateway
            await execAsync(`ip route add ${route} 2>/dev/null || true`);
            console.log('Restored original route');
          }
        }
        // Clean up the file
        fs.unlinkSync(routeFile);
      }
    } catch (e) {
      console.error('Failed to restore routes:', e.message);
    }
  }

  async startSingboxTun(server) {
    const config = this.generateSingboxTunConfig(server);
    const configFile = path.join(this.configPath, 'singbox-config.json');
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log('Sing-box TUN config written');
    
    // Make executable on Linux
    if (this.isLinux) {
      try {
        fs.chmodSync(this.singboxPath, 0o755);
      } catch (e) {
        console.log('chmod failed:', e.message);
      }
    }
    
    // Check if we need elevated privileges
    let needsElevation = false;
    let useMethod = 'direct';
    
    if (this.isLinux) {
      try {
        const { stdout: uid } = await execAsync('id -u');
        const isRoot = uid.trim() === '0';
        
        if (!isRoot) {
          const { stdout: caps } = await execAsync(`getcap "${this.singboxPath}" 2>/dev/null || echo ""`);
          const hasCaps = caps.includes('cap_net_admin+ep');
          
          if (!hasCaps) {
            needsElevation = true;
            // Check if pkexec is available
            try {
              await execAsync('which pkexec 2>/dev/null');
              useMethod = 'pkexec';
            } catch {
              throw new Error('TUN mode requires pkexec (polkit). Install: sudo pacman -S polkit');
            }
          }
        }
      } catch (e) {
        if (e.message.includes('pkexec')) throw e;
      }
    }
    
    return new Promise((resolve, reject) => {
      let command, args;
      
      if (needsElevation && useMethod === 'pkexec') {
        console.log('Starting sing-box with pkexec...');
        command = 'pkexec';
        args = [this.singboxPath, 'run', '-c', configFile];
      } else {
        command = this.singboxPath;
        args = ['run', '-c', configFile];
      }
      
      const spawnOptions = this.isWindows 
        ? { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        : { stdio: ['ignore', 'pipe', 'pipe'] };
      
      this.coreProcess = spawn(command, args, spawnOptions);
      
      let started = false;
      
      this.coreProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        console.log('sing-box:', msg.trim());
        if (msg.includes('started') || msg.includes('tun')) {
          if (!started) { started = true; setTimeout(resolve, 1000); }
        }
      });
      
      this.coreProcess.stderr.on('data', (data) => {
        console.log('sing-box:', data.toString().trim());
      });
      
      this.coreProcess.on('error', (err) => {
        console.error('sing-box error:', err);
        reject(err);
      });
      
      this.coreProcess.on('exit', (code) => {
        console.log('sing-box exited with code:', code);
        if (!started) {
          if (code === 126 || code === 127) {
            reject(new Error('Authentication cancelled or failed'));
          } else {
            reject(new Error(`sing-box exited with code ${code}`));
          }
        }
      });
      
      setTimeout(() => { if (!started) { started = true; resolve(); } }, 3000);
    });
  }

  generateSingboxTunConfig(server) {
    // Like Happ: sing-box TUN -> Xray SOCKS proxy -> VPN server
    // DNS goes through VPN to prevent leaks
    
    // Collect all addresses that need direct connection to avoid routing loops
    const directDomains = [];
    const directIPs = [];
    
    // Server address (can be IP or domain)
    const isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(server.address);
    if (isIP) {
      directIPs.push(server.address);
    } else {
      directDomains.push(server.address);
    }
    
    // For XHTTP/splithttp, also exclude the host header domain
    if ((server.network === 'xhttp' || server.network === 'splithttp') && server.host) {
      const hostIsIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(server.host);
      if (hostIsIP) {
        if (!directIPs.includes(server.host)) directIPs.push(server.host);
      } else {
        if (!directDomains.includes(server.host)) directDomains.push(server.host);
      }
    }
    
    // SNI domain should also go direct
    if (server.sni && server.sni !== server.address) {
      const sniIsIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(server.sni);
      if (sniIsIP) {
        if (!directIPs.includes(server.sni)) directIPs.push(server.sni);
      } else {
        if (!directDomains.includes(server.sni)) directDomains.push(server.sni);
      }
    }
    
    // Build routing rules
    const rules = [
      { protocol: 'dns', outbound: 'dns-out' },
      { ip_is_private: true, outbound: 'direct' },
      // Block IPv6 to prevent leaks
      { ip_version: 6, outbound: 'block' }
    ];
    
    // Add domain rules for direct connection (VPN server only)
    if (directDomains.length > 0) {
      rules.push({ domain: directDomains, outbound: 'direct' });
    }
    
    // Add IP rules for direct connection (VPN server only)
    if (directIPs.length > 0) {
      rules.push({ ip_cidr: directIPs.map(ip => ip + '/32'), outbound: 'direct' });
    }
    
    return {
      log: { level: 'info' },
      dns: {
        servers: [
          {
            tag: 'remote',
            address: 'https://1.1.1.1/dns-query',  // DoH through VPN
            address_resolver: 'local',
            detour: 'proxy'
          },
          {
            tag: 'local',
            address: '1.1.1.1',  // Only for VPN server resolution
            detour: 'direct'
          }
        ],
        rules: [
          {
            domain: directDomains.length > 0 ? directDomains : [server.address],
            server: 'local'
          }
        ],
        final: 'remote',
        strategy: 'ipv4_only',
        disable_cache: false,
        disable_expire: false
      },
      inbounds: [
        {
          type: 'tun',
          tag: 'tun-in',
          interface_name: 'sientel-tun',
          address: ['172.18.0.1/30'],
          auto_route: true,
          strict_route: true,
          stack: 'system',
          sniff: true,
          sniff_override_destination: false
        }
      ],
      outbounds: [
        {
          type: 'socks',
          tag: 'proxy',
          server: '127.0.0.1',
          server_port: this.socksPort
        },
        { type: 'direct', tag: 'direct' },
        { type: 'block', tag: 'block' },
        { type: 'dns', tag: 'dns-out' }
      ],
      route: {
        auto_detect_interface: true,
        final: 'proxy',
        rules: rules
      }
    };
  }

  // Start sing-box directly for protocols not supported by Xray (Hysteria2, TUIC, etc.)
  async startSingboxDirect(server, tunMode = false) {
    const config = this.generateSingboxDirectConfig(server, tunMode);
    const configFile = path.join(this.configPath, 'singbox-direct.json');
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log('Sing-box direct config written for', server.type);
    
    // Make executable on Linux
    if (this.isLinux) {
      try {
        fs.chmodSync(this.singboxPath, 0o755);
      } catch (e) {
        console.log('chmod failed:', e.message);
      }
    }
    
    // Check if we need elevated privileges for TUN mode
    let needsElevation = false;
    let useMethod = 'direct';
    
    if (tunMode && this.isLinux) {
      try {
        const { stdout: uid } = await execAsync('id -u');
        const isRoot = uid.trim() === '0';
        
        if (!isRoot) {
          const { stdout: caps } = await execAsync(`getcap "${this.singboxPath}" 2>/dev/null || echo ""`);
          const hasCaps = caps.includes('cap_net_admin+ep');
          
          if (!hasCaps) {
            needsElevation = true;
            try {
              await execAsync('which pkexec 2>/dev/null');
              useMethod = 'pkexec';
            } catch {
              throw new Error('TUN mode requires pkexec (polkit). Install: sudo pacman -S polkit');
            }
          }
        }
      } catch (e) {
        if (e.message.includes('pkexec')) throw e;
      }
    }
    
    return new Promise((resolve, reject) => {
      let command, args;
      
      if (needsElevation && useMethod === 'pkexec') {
        console.log('Starting sing-box with pkexec...');
        command = 'pkexec';
        args = [this.singboxPath, 'run', '-c', configFile];
      } else {
        command = this.singboxPath;
        args = ['run', '-c', configFile];
      }
      
      const spawnOptions = this.isWindows 
        ? { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        : { stdio: ['ignore', 'pipe', 'pipe'] };
      
      this.coreProcess = spawn(command, args, spawnOptions);
      
      let started = false;
      
      this.coreProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        console.log('sing-box:', msg.trim());
        if (msg.includes('started') || msg.includes('inbound')) {
          if (!started) { started = true; setTimeout(resolve, 1000); }
        }
      });
      
      this.coreProcess.stderr.on('data', (data) => {
        console.log('sing-box:', data.toString().trim());
      });
      
      this.coreProcess.on('error', (err) => {
        console.error('sing-box error:', err);
        reject(err);
      });
      
      this.coreProcess.on('exit', (code) => {
        console.log('sing-box exited with code:', code);
        if (!started) {
          if (code === 126 || code === 127) {
            reject(new Error('Authentication cancelled or failed'));
          } else {
            reject(new Error(`sing-box exited with code ${code}`));
          }
        }
      });
      
      setTimeout(() => { if (!started) { started = true; resolve(); } }, 3000);
    });
  }

  // Generate sing-box config for direct connection (Hysteria2, TUIC, etc.)
  generateSingboxDirectConfig(server, tunMode = false) {
    const outbound = this.buildSingboxOutbound(server);
    
    // Collect addresses for direct routing
    const directDomains = [];
    const directIPs = [];
    const isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(server.address);
    if (isIP) {
      directIPs.push(server.address);
    } else {
      directDomains.push(server.address);
    }
    
    const rules = [
      { protocol: 'dns', outbound: 'dns-out' },
      { ip_is_private: true, outbound: 'direct' },
      // Block IPv6 to prevent leaks
      { ip_version: 6, outbound: 'block' }
    ];
    
    if (directDomains.length > 0) {
      rules.push({ domain: directDomains, outbound: 'direct' });
    }
    if (directIPs.length > 0) {
      rules.push({ ip_cidr: directIPs.map(ip => ip + '/32'), outbound: 'direct' });
    }
    
    const inbounds = tunMode ? [
      {
        type: 'tun',
        tag: 'tun-in',
        interface_name: 'sientel-tun',
        address: ['172.18.0.1/30'],
        auto_route: true,
        strict_route: true,
        stack: 'system',
        sniff: true
      }
    ] : [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: this.socksPort,
        sniff: true
      },
      {
        type: 'http',
        tag: 'http-in',
        listen: '127.0.0.1',
        listen_port: this.httpPort,
        sniff: true
      }
    ];
    
    return {
      log: { level: 'info' },
      dns: {
        servers: [
          {
            tag: 'remote',
            address: 'https://1.1.1.1/dns-query',  // DoH through VPN
            address_resolver: 'local',
            detour: 'proxy'
          },
          {
            tag: 'local',
            address: '1.1.1.1',  // Only for VPN server resolution
            detour: 'direct'
          }
        ],
        rules: [
          {
            domain: directDomains.length > 0 ? directDomains : [server.address],
            server: 'local'
          }
        ],
        final: 'remote',
        strategy: 'ipv4_only',
        disable_cache: false,
        disable_expire: false
      },
      inbounds,
      outbounds: [
        outbound,
        { type: 'direct', tag: 'direct' },
        { type: 'block', tag: 'block' },
        { type: 'dns', tag: 'dns-out' }
      ],
      route: {
        auto_detect_interface: true,
        final: 'proxy',
        rules
      }
    };
  }

  // Build sing-box outbound for any protocol
  buildSingboxOutbound(server) {
    const type = server.type;
    
    if (type === 'hysteria2') {
      return {
        type: 'hysteria2',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        password: server.password,
        tls: {
          enabled: true,
          server_name: server.sni || server.address,
          insecure: server.insecure || false
        }
      };
    }
    
    if (type === 'hysteria') {
      return {
        type: 'hysteria',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        auth_str: server.password,
        tls: {
          enabled: true,
          server_name: server.sni || server.address,
          insecure: server.insecure || false
        }
      };
    }
    
    if (type === 'tuic') {
      return {
        type: 'tuic',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        uuid: server.uuid,
        password: server.password,
        congestion_control: server.congestion || 'bbr',
        tls: {
          enabled: true,
          server_name: server.sni || server.address,
          alpn: server.alpn || ['h3']
        }
      };
    }
    
    if (type === 'vless') {
      const outbound = {
        type: 'vless',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        uuid: server.uuid,
        flow: server.flow || ''
      };
      
      if (server.security === 'tls' || server.security === 'reality') {
        outbound.tls = {
          enabled: true,
          server_name: server.sni || server.address,
          insecure: server.allowInsecure || false
        };
        
        if (server.security === 'reality') {
          outbound.tls.reality = {
            enabled: true,
            public_key: server.pbk,
            short_id: server.sid
          };
        }
        
        if (server.fp) {
          outbound.tls.utls = { fingerprint: server.fp };
        }
      }
      
      if (server.network === 'ws') {
        outbound.transport = {
          type: 'ws',
          path: server.path || '/',
          headers: { Host: server.host || server.address }
        };
      } else if (server.network === 'grpc') {
        outbound.transport = {
          type: 'grpc',
          service_name: server.serviceName || server.path || '',
          idle_timeout: '60s',
          ping_timeout: '15s',
          permit_without_stream: false
        };
      } else if (server.network === 'xhttp' || server.network === 'splithttp') {
        outbound.transport = {
          type: 'httpupgrade',
          path: server.path || '/',
          host: server.host || server.address
        };
      }
      
      return outbound;
    }
    
    if (type === 'vmess') {
      const outbound = {
        type: 'vmess',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        uuid: server.uuid,
        security: 'auto'
      };
      
      if (server.security === 'tls') {
        outbound.tls = {
          enabled: true,
          server_name: server.sni || server.address
        };
      }
      
      if (server.network === 'ws') {
        outbound.transport = {
          type: 'ws',
          path: server.path || '/'
        };
      } else if (server.network === 'grpc') {
        outbound.transport = {
          type: 'grpc',
          service_name: server.serviceName || server.path || ''
        };
      }
      
      return outbound;
    }
    
    if (type === 'trojan') {
      const outbound = {
        type: 'trojan',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        password: server.password,
        tls: {
          enabled: true,
          server_name: server.sni || server.address
        }
      };
      
      if (server.network === 'ws') {
        outbound.transport = {
          type: 'ws',
          path: server.path || '/'
        };
      } else if (server.network === 'grpc') {
        outbound.transport = {
          type: 'grpc',
          service_name: server.serviceName || server.path || ''
        };
      }
      
      return outbound;
    }
    
    if (type === 'shadowsocks') {
      return {
        type: 'shadowsocks',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        method: server.method,
        password: server.password
      };
    }
    
    if (type === 'shadowsocksr') {
      return {
        type: 'shadowsocksr',
        tag: 'proxy',
        server: server.address,
        server_port: server.port,
        method: server.method,
        password: server.password,
        protocol: server.protocol,
        obfs: server.obfs
      };
    }
    
    // Fallback to SOCKS
    return {
      type: 'socks',
      tag: 'proxy',
      server: server.address,
      server_port: server.port
    };
  }

  getStatus() {
    return {
      connected: this.connected,
      server: this.currentServer,
      localPort: this.socksPort,
      httpPort: this.httpPort
    };
  }

  async setSystemProxy(enable) {
    if (this.isWindows) {
      try {
        if (enable) {
          await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`);
          await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:${this.httpPort}" /f`);
          console.log('System proxy enabled on port', this.httpPort);
        } else {
          await execAsync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`);
          console.log('System proxy disabled');
        }
      } catch (e) {
        console.error('Failed to set system proxy:', e.message);
      }
    } else if (this.isLinux) {
      await this.setLinuxProxy(enable);
    }
  }

  async setLinuxProxy(enable) {
    const proxyEnvFile = path.join(this.configPath, 'proxy-env.sh');
    
    try {
      if (enable) {
        const proxyUrl = `http://127.0.0.1:${this.httpPort}`;
        const socksUrl = `socks5://127.0.0.1:${this.socksPort}`;
        
        // 1. Create environment variables file for universal compatibility
        const envContent = `# Sientel VPN Proxy Settings
export http_proxy="${proxyUrl}"
export https_proxy="${proxyUrl}"
export HTTP_PROXY="${proxyUrl}"
export HTTPS_PROXY="${proxyUrl}"
export ftp_proxy="${proxyUrl}"
export FTP_PROXY="${proxyUrl}"
export all_proxy="${socksUrl}"
export ALL_PROXY="${socksUrl}"
export no_proxy="localhost,127.0.0.1,::1"
export NO_PROXY="localhost,127.0.0.1,::1"
`;
        fs.writeFileSync(proxyEnvFile, envContent);
        console.log('Proxy environment file created:', proxyEnvFile);
        
        // 2. Try GNOME (gsettings)
        try {
          await execAsync(`which gsettings 2>/dev/null`);
          await execAsync(`gsettings set org.gnome.system.proxy mode 'manual'`);
          await execAsync(`gsettings set org.gnome.system.proxy.http host '127.0.0.1'`);
          await execAsync(`gsettings set org.gnome.system.proxy.http port ${this.httpPort}`);
          await execAsync(`gsettings set org.gnome.system.proxy.https host '127.0.0.1'`);
          await execAsync(`gsettings set org.gnome.system.proxy.https port ${this.httpPort}`);
          await execAsync(`gsettings set org.gnome.system.proxy.socks host '127.0.0.1'`);
          await execAsync(`gsettings set org.gnome.system.proxy.socks port ${this.socksPort}`);
          await execAsync(`gsettings set org.gnome.system.proxy ignore-hosts "['localhost', '127.0.0.0/8', '::1']"`);
          console.log('✓ GNOME proxy enabled');
        } catch (e) {
          console.log('GNOME gsettings not available');
        }
        
        // 3. Try KDE (kwriteconfig5 or kwriteconfig6)
        try {
          const kwriteCmd = await execAsync(`which kwriteconfig6 2>/dev/null || which kwriteconfig5 2>/dev/null`).then(r => r.stdout.trim()).catch(() => null);
          if (kwriteCmd) {
            await execAsync(`${kwriteCmd} --file kioslaverc --group 'Proxy Settings' --key ProxyType 1`);
            await execAsync(`${kwriteCmd} --file kioslaverc --group 'Proxy Settings' --key httpProxy "http://127.0.0.1:${this.httpPort}"`);
            await execAsync(`${kwriteCmd} --file kioslaverc --group 'Proxy Settings' --key httpsProxy "http://127.0.0.1:${this.httpPort}"`);
            await execAsync(`${kwriteCmd} --file kioslaverc --group 'Proxy Settings' --key socksProxy "socks://127.0.0.1:${this.socksPort}"`);
            await execAsync(`${kwriteCmd} --file kioslaverc --group 'Proxy Settings' --key NoProxyFor "localhost,127.0.0.1,::1"`);
            await execAsync(`dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:'' 2>/dev/null || true`);
            console.log('✓ KDE proxy enabled');
          }
        } catch (e) {
          console.log('KDE kwriteconfig not available');
        }
        
        // 4. Detect Hyprland and other WMs
        const session = process.env.XDG_SESSION_DESKTOP || process.env.DESKTOP_SESSION || '';
        const isHyprland = session.toLowerCase().includes('hyprland') || process.env.HYPRLAND_INSTANCE_SIGNATURE;
        
        if (isHyprland) {
          console.log('✓ Hyprland detected - proxy via environment variables');
          // For Hyprland, apps need to be launched with proxy env vars
          // We'll set them globally via systemd user environment
          try {
            await execAsync(`systemctl --user import-environment http_proxy https_proxy all_proxy`);
            await execAsync(`dbus-update-activation-environment --systemd http_proxy https_proxy all_proxy 2>/dev/null || true`);
            console.log('✓ Proxy exported to systemd user environment');
          } catch (e) {
            console.log('Could not export to systemd environment');
          }
        }
        
        // 5. Set for current process and child processes
        process.env.http_proxy = proxyUrl;
        process.env.https_proxy = proxyUrl;
        process.env.HTTP_PROXY = proxyUrl;
        process.env.HTTPS_PROXY = proxyUrl;
        process.env.all_proxy = socksUrl;
        process.env.ALL_PROXY = socksUrl;
        
        console.log('✓ Proxy enabled');
        console.log(`  HTTP/HTTPS: ${proxyUrl}`);
        console.log(`  SOCKS5: ${socksUrl}`);
        
      } else {
        // Disable proxy
        
        if (fs.existsSync(proxyEnvFile)) {
          fs.unlinkSync(proxyEnvFile);
        }
        
        // GNOME
        try {
          await execAsync(`gsettings set org.gnome.system.proxy mode 'none' 2>/dev/null || true`);
        } catch {}
        
        // KDE
        try {
          const kwriteCmd = await execAsync(`which kwriteconfig6 2>/dev/null || which kwriteconfig5 2>/dev/null`).then(r => r.stdout.trim()).catch(() => null);
          if (kwriteCmd) {
            await execAsync(`${kwriteCmd} --file kioslaverc --group 'Proxy Settings' --key ProxyType 0`);
            await execAsync(`dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:'' 2>/dev/null || true`);
          }
        } catch {}
        
        // Clear systemd environment
        try {
          await execAsync(`systemctl --user unset-environment http_proxy https_proxy all_proxy 2>/dev/null || true`);
        } catch {}
        
        // Clear environment variables
        delete process.env.http_proxy;
        delete process.env.https_proxy;
        delete process.env.HTTP_PROXY;
        delete process.env.HTTPS_PROXY;
        delete process.env.all_proxy;
        delete process.env.ALL_PROXY;
        
        console.log('✓ Proxy disabled');
      }
    } catch (e) {
      console.error('Failed to set Linux proxy:', e.message);
    }
  }

  async downloadXray() {
    return downloadXray(this.configPath, this.isLinux, this.emitProgress.bind(this));
  }

  async downloadSingbox() {
    return downloadSingbox(this.configPath, this.isLinux, this.emitProgress.bind(this));
  }

  async downloadWintun() {
    if (!this.isWindows) {
      console.log('WinTUN not needed on Linux');
      return Promise.resolve();
    }
    return downloadWintun(this.configPath, this.emitProgress.bind(this));
  }

  async ensureComponents() {
    const missing = [];
    if (!fs.existsSync(this.xrayPath)) missing.push('xray');
    if (!fs.existsSync(this.singboxPath)) missing.push('sing-box');
    if (this.isWindows && !fs.existsSync(this.wintunPath)) missing.push('wintun');
    
    if (missing.length === 0) {
      console.log('All components present');
      return;
    }
    
    console.log('Missing components:', missing.join(', '));
    
    for (const component of missing) {
      if (component === 'xray') {
        console.log('Downloading Xray...');
        await this.downloadXray();
      } else if (component === 'sing-box') {
        console.log('Downloading sing-box...');
        await this.downloadSingbox();
      } else if (component === 'wintun') {
        console.log('Downloading WinTUN...');
        await this.downloadWintun();
      }
    }
    
    console.log('All components ready');
  }
}

module.exports = VlessCore;
