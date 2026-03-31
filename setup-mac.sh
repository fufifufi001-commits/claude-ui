#!/bin/bash
# Claude UI - macOS Kurulum Scripti
# Kullanim: Bu dosyayi cift tikla veya terminalde calistir:
#   chmod +x setup-mac.sh && ./setup-mac.sh

echo ""
echo "==============================="
echo "  Claude UI - macOS Kurulum"
echo "==============================="
echo ""

# Node.js kontrolu
if ! command -v node &> /dev/null; then
    echo "Node.js bulunamadi. Kuruluyor..."
    if command -v brew &> /dev/null; then
        brew install node
    else
        echo "Homebrew bulunamadi. Once Homebrew kurun:"
        echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        echo "Sonra bu scripti tekrar calistirin."
        exit 1
    fi
fi

# Claude CLI kontrolu
if ! command -v claude &> /dev/null; then
    echo "Claude CLI bulunamadi. Kuruluyor..."
    npm install -g @anthropic-ai/claude-code
fi

echo "Bagimliliklar yukleniyor..."
npm install

echo ""
echo "Build baslatiliyor..."
npx electron-builder --mac

echo ""
echo "==============================="
echo "  Kurulum tamamlandi!"
echo "  dist/ klasorunde .dmg dosyasi olusturuldu"
echo "  Veya hemen baslatmak icin: npm start"
echo "==============================="
