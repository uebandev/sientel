# Maintainer: Sientel Team <support@sientel.com>
pkgname=sientel-bin
pkgver=1.0.0
pkgrel=1
pkgdesc="Modern VPN client with support for VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC"
arch=('x86_64' 'aarch64')
url="https://github.com/yourusername/sientel"
license=('MIT')
depends=('fuse2' 'polkit')
optdepends=(
    'libappindicator-gtk3: for system tray icon support'
)
provides=('sientel')
conflicts=('sientel')

source_x86_64=("${pkgname}-${pkgver}.AppImage::https://github.com/yourusername/sientel/releases/download/v${pkgver}/Sientel-${pkgver}.AppImage")
source_aarch64=("${pkgname}-${pkgver}.AppImage::https://github.com/yourusername/sientel/releases/download/v${pkgver}/Sientel-${pkgver}-arm64.AppImage")

sha256sums_x86_64=('SKIP')
sha256sums_aarch64=('SKIP')

prepare() {
    chmod +x "${pkgname}-${pkgver}.AppImage"
    ./"${pkgname}-${pkgver}.AppImage" --appimage-extract
}

package() {
    # Install application files
    install -dm755 "${pkgdir}/opt/${pkgname}"
    cp -r squashfs-root/* "${pkgdir}/opt/${pkgname}/"
    
    # Create launcher script
    install -dm755 "${pkgdir}/usr/bin"
    cat > "${pkgdir}/usr/bin/sientel" << 'EOF'
#!/bin/bash
exec /opt/sientel-bin/sientel "$@"
EOF
    chmod +x "${pkgdir}/usr/bin/sientel"
    
    # Install desktop file
    install -Dm644 squashfs-root/sientel.desktop "${pkgdir}/usr/share/applications/sientel.desktop"
    sed -i 's|Exec=.*|Exec=/usr/bin/sientel|g' "${pkgdir}/usr/share/applications/sientel.desktop"
    
    # Install icon
    install -Dm644 squashfs-root/usr/share/icons/hicolor/0x0/apps/sientel.png \
        "${pkgdir}/usr/share/pixmaps/sientel.png"
    
    # Install license
    install -Dm644 squashfs-root/LICENSE.electron.txt "${pkgdir}/usr/share/licenses/${pkgname}/LICENSE"
}
