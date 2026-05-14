# Sientel VPN Client

<div align="center">

![Sientel Logo](src/assets/icon.png)

**Modern cross-platform VPN client with support for multiple protocols**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey.svg)](https://github.com/uebandev/sientel)

**English** | [Русский](README.md)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Protocols](#supported-protocols) • [Building](#building)

</div>

---

## Features

- 🚀 **Multiple Protocols**: VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC
- 🌐 **Transport Support**: TCP, WebSocket, gRPC, xHTTP (splithttp), HTTP/2
- 🔒 **TUN Mode**: System-wide VPN with automatic routing
- 🎯 **Proxy Mode**: HTTP/SOCKS5 proxy for application-level routing
- 📡 **Subscription Support**: Auto-update from subscription URLs
- 🎨 **Modern UI**: Clean, intuitive interface with dark theme
- ⚡ **Fast & Lightweight**: Built with Electron and native VPN cores
- 🔄 **Auto-connect**: Start VPN automatically on system boot

## Installation

### Linux

Download the latest AppImage from [Releases](https://github.com/uebandev/sientel/releases):

```bash
# Download
wget https://github.com/uebandev/sientel/releases/latest/download/Sientel-1.0.0.AppImage

# Make executable
chmod +x Sientel-1.0.0.AppImage

# Run
./Sientel-1.0.0.AppImage
```

**Requirements:**
- `fuse2` - for AppImage support
- `polkit` - for TUN mode (GUI password prompt)

**Debian/Ubuntu:**
```bash
sudo apt install fuse libfuse2 policykit-1
```

**Arch Linux:**
```bash
sudo pacman -S fuse2 polkit
```

### Windows

Download the installer from [Releases](https://github.com/uebandev/sientel/releases) and run it.

## Usage

### Quick Start

1. **Add Subscription**
   - Click the `+` button
   - Paste your subscription URL
   - Servers will be automatically imported

2. **Connect**
   - Select a server from the list
   - Choose mode: **Proxy** or **TUN**
   - Click **Connect**

### Connection Modes

#### Proxy Mode
- HTTP proxy on `127.0.0.1:10809`
- SOCKS5 proxy on `127.0.0.1:10808`
- Configure applications to use these proxies
- No root/admin privileges required

#### TUN Mode
- System-wide VPN
- All traffic automatically routed through VPN
- Requires authentication (polkit on Linux, admin on Windows)
- Recommended for most users

### Desktop Environments

**GNOME/KDE/XFCE**: Proxy settings configured automatically

**Hyprland/i3/Sway**: Use TUN mode for automatic routing, or configure proxy manually:
```bash
export http_proxy=http://127.0.0.1:10809
export https_proxy=http://127.0.0.1:10809
```

## Supported Protocols

| Protocol | Proxy Mode | TUN Mode | Transports |
|----------|------------|----------|------------|
| VLESS | ✅ | ✅ | TCP, WS, gRPC, xHTTP, HTTP/2 |
| VMess | ✅ | ✅ | TCP, WS, gRPC, xHTTP, HTTP/2 |
| Trojan | ✅ | ✅ | TCP, WS, gRPC |
| Shadowsocks | ✅ | ✅ | TCP, UDP |
| Hysteria2 | ✅ | ✅ | UDP (QUIC) |
| TUIC | ✅ | ✅ | UDP (QUIC) |

### Transport Features

- **Reality**: Full support with vision flow
- **TLS**: TLS 1.3 with custom fingerprinting
- **WebSocket**: With custom headers and path
- **gRPC**: Gun mode support
- **xHTTP**: Modern HTTP/3-like transport

## Building

### Prerequisites

```bash
# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# Or on Arch
sudo pacman -S nodejs npm
```

### Build from Source

```bash
# Clone repository
git clone https://github.com/uebandev/sientel.git
cd sientel

# Install dependencies
npm install

# Build for Linux
npm run build:linux

# Build for Windows
npm run build:win

# Development mode
npm run dev
```

### Build Outputs

- **Linux**: `dist/Sientel-1.0.0.AppImage`
- **Windows**: `dist/Sientel Setup 1.0.0.exe`

## Architecture

Sientel uses two VPN cores:

- **Xray-core**: For VLESS, VMess, Trojan, Shadowsocks
- **sing-box**: For Hysteria2, TUIC, and TUN interface

### TUN Mode Architecture

```
Applications
     ↓
TUN Interface (sing-box)
     ↓
SOCKS Proxy (Xray)
     ↓
VPN Server
```

## Configuration

Configuration stored in:
- **Linux**: `~/.config/sientel-client/`
- **Windows**: `%APPDATA%\.sientel-client\`

Files:
- `data.json` - Subscriptions and servers
- `config.json` - Xray configuration
- `singbox-config.json` - sing-box configuration
- `xray` / `sing-box` - VPN core binaries (auto-downloaded)

## Troubleshooting

### AppImage doesn't start
```bash
# Install FUSE2
sudo pacman -S fuse2  # Arch
sudo apt install libfuse2  # Debian/Ubuntu
```

### TUN mode fails
```bash
# Install polkit
sudo pacman -S polkit  # Arch
sudo apt install policykit-1  # Debian/Ubuntu
```

### Proxy mode not working
Check if Xray is running:
```bash
ps aux | grep xray
ss -tuln | grep -E '10808|10809'
```

Test proxy:
```bash
curl -x http://127.0.0.1:10809 https://api.ipify.org
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Xray-core](https://github.com/XTLS/Xray-core) - High-performance proxy core
- [sing-box](https://github.com/SagerNet/sing-box) - Universal proxy platform
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework

---

<div align="center">
Made with ❤️ by Sientel Team
</div>
