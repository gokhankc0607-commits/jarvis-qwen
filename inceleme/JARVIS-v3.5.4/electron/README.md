# JARVIS — Electron Masaüstü Uygulaması

JARVIS panelini tarayıcı yerine **bağımsız bir masaüstü penceresi** olarak çalıştırır.
Uygulama açıldığında yerel Next.js sunucusunu arka planda başlatır, panel hazır olunca
pencereyi açar; pencere kapatıldığında sunucu da dahil tüm süreçler temiz kapanır
(gömülü PGlite/LanceDB dosya kilidinin sızdırmaz şekilde bırakılması için önemlidir).

> Veriler yine %100 bu makinede kalır: `./data` (PGlite) ve `./.lancedb`. Bulut yok.

## 1) Kurulum (geliştirici / kendi kullanım)

```bash
cd JARVIS-v3.5.4
npm install          # electron, electron-builder, cross-env, concurrently, wait-on da gelir
npm run build        # panel derlemesi (.next) — Electron bundan sonra "next start" çalıştırır
npm run electron     # masaüstü penceresini aç (build'li mod)
```

Geliştirme modu (hot-reload ile çalışırken pencerede görmek):

```bash
npm run electron:dev # 1) next dev 2) sunucu ayağa kalkınca Electron penceresi
```

## 2) Windows'ta kurulum/çalıştırma (.bat)

Depoyu `PANEL_KUR.bat` ile kurduysanız aynı klasörde yeterlidir:

```bat
npm install
npm run build
npm run electron
```

## 3) Yayımlanabilir paket üretme (installer)

```bash
npm run dist
```

Çıktı: `electron/release/` altında
- Windows: `JARVIS Setup 3.5.4.exe` (NSIS kurulumu, masaüstü kısayolu oluşturur)
- macOS: `JARVIS-3.5.4.dmg`
- Linux: `JARVIS-3.5.4.AppImage`

Notlar:
- Paketleme sırasında panel `.next` çıktısı ve `node_modules` asar içine alınır;
  PGlite WASM dosyaları `asarUnpack` ile paketten dışarı çıkarılır (aksi halde
  gömülü veritabanı yüklenemez). Native eklentiler (`**/*.node`) de otomatik
  olarak paketten dışarı alınır.
- Uygulama simgesi koymak isterseniz `electron/build/icon.ico` (Win),
  `icon.icns` (macOS), `icon.png` (Linux) ekleyin; yoksa Electron varsayılan simgesi kullanılır.
- Farklı bir port gerekiyorsa `JARVIS_PORT=3123 npm run electron` gibi verebilirsiniz.

## 4) Davranış özeti

| Özellik | Açıklama |
|---|---|
| Tek örnek | İkinci pencere açılmaz; mevcut pencere öne gelir |
| Pencere hafızası | Son boyut/konum/küçük ekran durumu hatırlanır (`electron-store`) |
| Menü | Yenile, DevTools, yakınlaştırma, tam ekran, "Veri konumu" |
| Harici bağlantılar | Sistem tarayıcısında açılır (Electron içinde değil) |
| Kapanış | Pencere kapanınca panel sunucusu da kill edilir (Windows'ta `taskkill /T`) |
| Hata durumunda | `.next` yoksa veya sunucu çökerse Türkçe hata kutusu gösterilir |

## 5) Dosyalar

```
electron/
  main.js        # ana süreç: sunucu yaşam döngüsü + pencere + menü
  package.json   # electron-builder yaplandırması (release/ çıktı klasörü)
  README.md      # bu dosya
```
