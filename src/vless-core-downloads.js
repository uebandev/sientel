// Platform-specific download functions for Xray and sing-box
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

async function downloadXray(configPath, isLinux, emitProgress) {
  const AdmZip = require('adm-zip');
  const version = '25.1.1';
  
  // Detect architecture
  let arch = process.arch;
  if (arch === 'x64') arch = isLinux ? 'linux-64' : 'windows-64';
  else if (arch === 'arm64') arch = isLinux ? 'linux-arm64-v8a' : 'windows-arm64-v8a';
  else if (arch === 'arm') arch = isLinux ? 'linux-arm32-v7a' : 'windows-arm32-v7a';
  
  const platform = isLinux ? 'linux' : 'windows';
  const downloadUrl = `https://github.com/XTLS/Xray-core/releases/download/v${version}/Xray-${arch}.zip`;
  const zipPath = path.join(configPath, 'xray.zip');
  
  console.log('Downloading Xray from:', downloadUrl);
  emitProgress('xray', 0, 'Подключение к GitHub...');
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);
    
    const download = (url) => {
      const protocol = url.startsWith('https') ? https : require('http');
      protocol.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          emitProgress('xray', 0, 'Перенаправление...');
          download(response.headers.location);
          return;
        }
        
        if (response.statusCode !== 200) {
          emitProgress('xray', 0, 'Ошибка загрузки');
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }
        
        const total = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const percent = Math.round((downloaded / total) * 100);
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            const totalMb = (total / 1024 / 1024).toFixed(1);
            emitProgress('xray', percent, `Загрузка Xray: ${mb}/${totalMb} MB`);
          }
        });
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          emitProgress('xray', 100, 'Распаковка Xray...');
          
          try {
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(configPath, true);
            fs.unlinkSync(zipPath);
            
            // Make executable on Linux
            if (isLinux) {
              const xrayPath = path.join(configPath, 'xray');
              try {
                fs.chmodSync(xrayPath, 0o755);
              } catch (e) {
                console.log('chmod failed:', e.message);
              }
            }
            
            emitProgress('xray', 100, 'Xray готов');
            console.log('Xray extracted to:', configPath);
            resolve();
          } catch (e) {
            emitProgress('xray', 0, 'Ошибка распаковки');
            reject(e);
          }
        });
      }).on('error', (e) => {
        emitProgress('xray', 0, 'Ошибка сети');
        reject(e);
      });
    };
    
    download(downloadUrl);
  });
}

async function downloadSingbox(configPath, isLinux, emitProgress) {
  const version = '1.10.3';
  
  // Detect architecture
  let arch = process.arch;
  if (arch === 'x64') arch = 'amd64';
  else if (arch === 'arm64') arch = 'arm64';
  else if (arch === 'arm') arch = 'armv7';
  
  const platform = isLinux ? 'linux' : 'windows';
  const fileExt = isLinux ? 'tar.gz' : 'zip';
  const downloadUrl = `https://github.com/SagerNet/sing-box/releases/download/v${version}/sing-box-${version}-${platform}-${arch}.${fileExt}`;
  const archivePath = path.join(configPath, isLinux ? 'singbox.tar.gz' : 'singbox.zip');
  
  console.log('Downloading sing-box from:', downloadUrl);
  emitProgress('singbox', 0, 'Подключение к GitHub...');
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(archivePath);
    
    const download = (url) => {
      const protocol = url.startsWith('https') ? https : require('http');
      protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          emitProgress('singbox', 0, 'Перенаправление...');
          download(response.headers.location);
          return;
        }
        
        if (response.statusCode !== 200) {
          emitProgress('singbox', 0, 'Ошибка загрузки');
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }
        
        const total = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const percent = Math.round((downloaded / total) * 100);
            const mb = (downloaded / 1024 / 1024).toFixed(1);
            const totalMb = (total / 1024 / 1024).toFixed(1);
            emitProgress('singbox', percent, `Загрузка sing-box: ${mb}/${totalMb} MB`);
          }
        });
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          emitProgress('singbox', 100, 'Распаковка sing-box...');
          
          try {
            const binaryName = isLinux ? 'sing-box' : 'sing-box.exe';
            const targetPath = path.join(configPath, binaryName);
            
            if (isLinux) {
              // Extract tar.gz on Linux
              const { execSync } = require('child_process');
              const extractDir = path.join(configPath, 'singbox-temp');
              
              // Create temp directory
              if (!fs.existsSync(extractDir)) {
                fs.mkdirSync(extractDir, { recursive: true });
              }
              
              // Extract tar.gz
              execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { encoding: 'utf8' });
              
              // Find sing-box binary in extracted files
              const findBinary = (dir) => {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                  const fullPath = path.join(dir, item);
                  const stat = fs.statSync(fullPath);
                  if (stat.isDirectory()) {
                    const result = findBinary(fullPath);
                    if (result) return result;
                  } else if (item === 'sing-box') {
                    return fullPath;
                  }
                }
                return null;
              };
              
              const binaryPath = findBinary(extractDir);
              if (!binaryPath) {
                throw new Error('sing-box binary not found in archive');
              }
              
              // Copy to target location
              fs.copyFileSync(binaryPath, targetPath);
              
              // Cleanup
              fs.rmSync(extractDir, { recursive: true, force: true });
              fs.unlinkSync(archivePath);
              
              // Make executable
              fs.chmodSync(targetPath, 0o755);
            } else {
              // Extract zip on Windows
              const AdmZip = require('adm-zip');
              const zip = new AdmZip(archivePath);
              const entries = zip.getEntries();
              
              for (const entry of entries) {
                if (entry.entryName.endsWith(binaryName)) {
                  fs.writeFileSync(targetPath, entry.getData());
                  break;
                }
              }
              
              fs.unlinkSync(archivePath);
            }
            
            emitProgress('singbox', 100, 'sing-box готов');
            console.log('sing-box downloaded');
            resolve();
          } catch (e) {
            emitProgress('singbox', 0, 'Ошибка распаковки');
            console.error('Extract error:', e);
            reject(e);
          }
        });
      }).on('error', (e) => {
        emitProgress('singbox', 0, 'Ошибка сети');
        reject(e);
      });
    };
    
    download(downloadUrl);
  });
}

async function downloadWintun(configPath, emitProgress) {
  // WinTUN is Windows-only
  const AdmZip = require('adm-zip');
  const downloadUrl = 'https://www.wintun.net/builds/wintun-0.14.1.zip';
  const zipPath = path.join(configPath, 'wintun.zip');
  
  console.log('Downloading wintun...');
  emitProgress('wintun', 0, 'Загрузка WinTUN драйвера...');
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);
    
    const download = (url) => {
      const protocol = url.startsWith('https') ? https : require('http');
      protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          download(response.headers.location);
          return;
        }
        
        const total = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        
        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const percent = Math.round((downloaded / total) * 100);
            emitProgress('wintun', percent, `Загрузка WinTUN: ${percent}%`);
          }
        });
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          emitProgress('wintun', 100, 'Распаковка WinTUN...');
          try {
            const zip = new AdmZip(zipPath);
            const entries = zip.getEntries();
            const wintunPath = path.join(configPath, 'wintun.dll');
            
            for (const entry of entries) {
              if (entry.entryName.includes('amd64') && entry.entryName.endsWith('wintun.dll')) {
                fs.writeFileSync(wintunPath, entry.getData());
                break;
              }
            }
            fs.unlinkSync(zipPath);
            emitProgress('wintun', 100, 'WinTUN готов');
            console.log('wintun downloaded');
            resolve();
          } catch (e) {
            emitProgress('wintun', 0, 'Ошибка распаковки');
            reject(e);
          }
        });
      }).on('error', (e) => {
        emitProgress('wintun', 0, 'Ошибка сети');
        reject(e);
      });
    };
    
    download(downloadUrl);
  });
}

module.exports = { downloadXray, downloadSingbox, downloadWintun };
