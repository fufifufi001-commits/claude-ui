# Claude UI - Mac Kurulum Talimati

## Gereksinimler

1. **Claude Code CLI** kurulu olmali:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Claude Code'a en az bir kez giris yapmis olmali:
   ```bash
   claude
   ```
   (Tarayici acilir, Anthropic hesabiyla giris yap, sonra terminali kapatabilirsin)

## Kurulum

1. GitHub Releases sayfasindan Mac zip dosyasini indir:
   https://github.com/fufifufi001-commits/claude-ui/releases/tag/v2.0.0

2. Zip dosyasini ac (cift tikla)

3. `Claude UI.app` dosyasini **Applications** klasorune surukle

4. Ilk acilista macOS "tanimsiz gelistirici" uyarisi verebilir:
   - **System Settings > Privacy & Security** bolumune git
   - En altta "Claude UI was blocked" mesajini bul
   - **Open Anyway** tikla

   Veya terminalden:
   ```bash
   xattr -cr /Applications/Claude\ UI.app
   ```

5. Uygulamayi ac. Ilk calistirmada kurulum sihirbazi cikacak:
   - **Claude CLI Kontrolu**: Yesil tik gorunmeli
   - **Session Gecmisi**: Varsayilan dizini kabul et veya degistir
   - **Calisma Dizini**: Projelerin oldugu ana dizini sec (orn. Home)

## Kullanim

- **Mesaj yaz** ve Enter'a bas
- **Ctrl+V** ile ekran goruntusu yapistir
- **exit** yazarak oturumu kapat ve kaydet
- **+** butonu ile yeni sohbet ac (isim iste)
- **Cift tikla** tab'a isim degistir
- **Sag tikla** sol paneldeki session'lara (sil, yeniden adlandir)
- **Tam Yetki** (kirmizi buton): Tum izinleri otomatik onaylar (dikkatli kullan!)

## Sorun Giderme

- **Claude CLI bulunamadi**: `which claude` ile kontrol et. Bulunamazsa `npm install -g @anthropic-ai/claude-code` calistir.
- **Uygulama acilmiyor**: `xattr -cr /Applications/Claude\ UI.app` calistir.
- **Mesaj gonderilmiyor**: Claude CLI'a giris yaptiginden emin ol (`claude` komutu terminalden calismali).
