# Sientel VPN Client

<div align="center">

![Sientel Logo](src/assets/icon.png)

**Современный кроссплатформенный VPN клиент с поддержкой множества протоколов**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey.svg)](https://github.com/yourusername/sientel)

[English](README.en.md) | **Русский**

[Возможности](#возможности) • [Установка](#установка) • [Использование](#использование) • [Протоколы](#поддерживаемые-протоколы) • [Сборка](#сборка)

</div>

---

## Возможности

- 🚀 **Множество протоколов**: VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC
- 🌐 **Поддержка транспортов**: TCP, WebSocket, gRPC, xHTTP (splithttp), HTTP/2
- 🔒 **TUN режим**: Системный VPN с автоматической маршрутизацией
- 🎯 **Proxy режим**: HTTP/SOCKS5 прокси для маршрутизации на уровне приложений
- 📡 **Поддержка подписок**: Автообновление с URL подписок
- 🎨 **Современный UI**: Чистый, интуитивный интерфейс с темной темой
- ⚡ **Быстрый и легкий**: Построен на Electron и нативных VPN ядрах
- 🔄 **Автоподключение**: Автоматический запуск VPN при старте системы

## Установка

### Arch Linux (AUR)

```bash
yay -S sientel-bin
```

### Другие дистрибутивы Linux

Скачайте последний AppImage из [Releases](https://github.com/yourusername/sientel/releases):

```bash
# Скачать
wget https://github.com/yourusername/sientel/releases/latest/download/Sientel-1.0.0.AppImage

# Сделать исполняемым
chmod +x Sientel-1.0.0.AppImage

# Запустить
./Sientel-1.0.0.AppImage
```

**Требования:**
- `fuse2` - для поддержки AppImage
- `polkit` - для TUN режима (GUI запрос пароля)

**Debian/Ubuntu:**
```bash
sudo apt install fuse libfuse2 policykit-1
```

**Arch Linux:**
```bash
sudo pacman -S fuse2 polkit
```

### Windows

Скачайте установщик из [Releases](https://github.com/yourusername/sientel/releases) и запустите его.

## Использование

### Быстрый старт

1. **Добавить подписку**
   - Нажмите кнопку `+`
   - Вставьте URL подписки
   - Серверы будут автоматически импортированы

2. **Подключиться**
   - Выберите сервер из списка
   - Выберите режим: **Proxy** или **TUN**
   - Нажмите **Подключиться**

### Режимы подключения

#### Proxy режим
- HTTP прокси на `127.0.0.1:10809`
- SOCKS5 прокси на `127.0.0.1:10808`
- Настройте приложения для использования этих прокси
- Не требует прав root/администратора

#### TUN режим
- Системный VPN
- Весь трафик автоматически маршрутизируется через VPN
- Требует аутентификации (polkit на Linux, администратор на Windows)
- Рекомендуется для большинства пользователей

### Окружения рабочего стола

**GNOME/KDE/XFCE**: Настройки прокси конфигурируются автоматически

**Hyprland/i3/Sway**: Используйте TUN режим для автоматической маршрутизации, или настройте прокси вручную:
```bash
export http_proxy=http://127.0.0.1:10809
export https_proxy=http://127.0.0.1:10809
```

## Поддерживаемые протоколы

| Протокол | Proxy режим | TUN режим | Транспорты |
|----------|-------------|-----------|------------|
| VLESS | ✅ | ✅ | TCP, WS, gRPC, xHTTP, HTTP/2 |
| VMess | ✅ | ✅ | TCP, WS, gRPC, xHTTP, HTTP/2 |
| Trojan | ✅ | ✅ | TCP, WS, gRPC |
| Shadowsocks | ✅ | ✅ | TCP, UDP |
| Hysteria2 | ✅ | ✅ | UDP (QUIC) |
| TUIC | ✅ | ✅ | UDP (QUIC) |

### Возможности транспортов

- **Reality**: Полная поддержка с vision flow
- **TLS**: TLS 1.3 с кастомным fingerprinting
- **WebSocket**: С кастомными заголовками и путями
- **gRPC**: Поддержка gun режима
- **xHTTP**: Современный HTTP/3-подобный транспорт

## Сборка

### Требования

```bash
# Установить Node.js и npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# Или на Arch
sudo pacman -S nodejs npm
```

### Сборка из исходников

```bash
# Клонировать репозиторий
git clone https://github.com/yourusername/sientel.git
cd sientel

# Установить зависимости
npm install

# Собрать для Linux
npm run build:linux

# Собрать для Windows
npm run build:win

# Режим разработки
npm run dev
```

### Результаты сборки

- **Linux**: `dist/Sientel-1.0.0.AppImage`
- **Windows**: `dist/Sientel Setup 1.0.0.exe`

## Архитектура

Sientel использует два VPN ядра:

- **Xray-core**: Для VLESS, VMess, Trojan, Shadowsocks
- **sing-box**: Для Hysteria2, TUIC и TUN интерфейса

### Архитектура TUN режима

```
Приложения
     ↓
TUN интерфейс (sing-box)
     ↓
SOCKS прокси (Xray)
     ↓
VPN сервер
```

## Конфигурация

Конфигурация хранится в:
- **Linux**: `~/.config/sientel-client/`
- **Windows**: `%APPDATA%\.sientel-client\`

Файлы:
- `data.json` - Подписки и серверы
- `config.json` - Конфигурация Xray
- `singbox-config.json` - Конфигурация sing-box
- `xray` / `sing-box` - Бинарники VPN ядер (загружаются автоматически)

## Решение проблем

### AppImage не запускается
```bash
# Установить FUSE2
sudo pacman -S fuse2  # Arch
sudo apt install libfuse2  # Debian/Ubuntu
```

### TUN режим не работает
```bash
# Установить polkit
sudo pacman -S polkit  # Arch
sudo apt install policykit-1  # Debian/Ubuntu
```

### Proxy режим не работает
Проверьте, запущен ли Xray:
```bash
ps aux | grep xray
ss -tuln | grep -E '10808|10809'
```

Проверьте прокси:
```bash
curl -x http://127.0.0.1:10809 https://api.ipify.org
```

## Участие в разработке

Мы приветствуем вклад в проект! Не стесняйтесь отправлять Pull Request.

1. Форкните репозиторий
2. Создайте ветку для вашей функции (`git checkout -b feature/amazing-feature`)
3. Закоммитьте изменения (`git commit -m 'Add amazing feature'`)
4. Запушьте в ветку (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

## Лицензия

Этот проект лицензирован под MIT License - см. файл [LICENSE](LICENSE) для деталей.

## Благодарности

- [Xray-core](https://github.com/XTLS/Xray-core) - Высокопроизводительное прокси ядро
- [sing-box](https://github.com/SagerNet/sing-box) - Универсальная прокси платформа
- [Electron](https://www.electronjs.org/) - Кроссплатформенный фреймворк для десктопа

## Поддержка

- 📱 Telegram: [@sientel](https://t.me/sientel)
- 🐛 Проблемы: [GitHub Issues](https://github.com/yourusername/sientel/issues)

---

<div align="center">
Сделано с ❤️ командой Sientel
</div>
