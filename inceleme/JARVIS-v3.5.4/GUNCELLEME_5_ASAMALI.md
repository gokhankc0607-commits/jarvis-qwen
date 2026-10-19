# KANAL — 5 Aşamalı Akış Güncellemesi

## Uygulananlar

- Sinyal akışı bağımsız RSI/CCI tetiklerinden çıkarılıp ardışık kurulum haline getirildi: M0 dış bant kapanışı + aynı mumdaki RSI bölgesi → MR'da en az 0.10 ATR içeri kapanış → RSI kesişimi → CCI/MA kesişimi.
- M3/M5 için 10, M15 için 8, H1 için 6 mumluk kurulum ömrü eklendi. Süresi dolan M0 kurulumu radarın aktif aşamalarından düşer.
- SL, kurulum ekstremi; TP, KANAL3BAND merkez çizgisi. R:R < 1:1 veya SL/TP yönü geçersizse sinyal engellenir.
- MT5 canlı taramada güncel spread/son 20 kapanmış mum ortalaması 2.5× sınırı ve gecikmiş tick/mum kontrolü eklendi. Kalite kontrolü başarısızsa sinyal/emir askıya alınır.
- Kriptoda order-book spread tavanı (%0,15 varsayılan), 24 saatlik USDT hacim tabanı ($5M varsayılan), borsa minimum notional'ı ve bayat ticker kontrolü eklendi. Eşiğin altındaki likidite pariteleri radardan gizlenir; spread/ticker uygun değilse emir bekletilir.
- Funding oranı her fonlama dönemi için ±%0,10 varsayılan eşiği aşarsa maliyetli yönde güven %15 azaltılır. Kripto ayarları KANAL → Gelişmiş Ayarlar bölümünden değiştirilebilir.
- Kripto taramasında BTC/USDT M15 trendi altcoin sinyal güvenine uygulanır: uyumluysa +10, ters trendse −%25.
- Yerel ajan ve MQL5 EA karşı TF'deki ters 5/5 sinyallerde emirleri kilitler; aynı yöndeki daha yüksek TF güvene +10 katar. Aynı parite/TF setup'ı tek sinyal/emir üretir.
- Setup kilidi ajan JSON dosyasına, MQL5 tarafında terminal Global Variables'a kalıcı yazılır. TP/SL fiyat seviyesine dokunma veya daha yeni ters M0 kapanışı kilidi sıfırlar.
- Radar 5 rozetli görünüme geçirildi; kanal durumu, beklenen adım ve R:R gösterilir. Satır seçimi piyasa ekranını parite/TF ile açar. Grafik aktif kurulumun M0, MR, RSI ve CCI mumlarını etiketler.
- Web panelindeki TypeScript ve yerel ajandaki Python akışı aynı temel sıralı mantığa göre güncellendi; MQL5 KANAL EA'sının sıralı akışı, TTL, merkez TP, R:R kapısı ve setup bazlı tekrar engeli de güncellendi.
- **v3.5.1 RSI sınır düzeltmesi:** eşik tam 30/70 olduğunda kesişim kaçmasın diye ALIŞ `RSI önce ≤30, sonra >30`; SATIŞ `önce ≥70, sonra <70` olarak tanımlandı.
- **v3.5.2 aynı-mum düzeltmesi:** güvenli dönüş (MR) mumunda RSI kesişimi, RSI teyit mumunda CCI/MA kesişimi de kabul edilir. Böylece iki gösterge aynı kapanmış mumda kesiştiyse radar bir sonraki mumu beklemez; açık mum/henüz kapanmamış kesişim sayılmaz. Panel, Python ajanı ve MQL5 EA eşitlendi.
- **v3.5.3 grafik:** PİYASA & GRAFİK ekranına RSI ve CCI'nin altına üçüncü osilatör paneli eklendi: Guppy GMMA OSC, EMA(10) sinyal çizgisi ve sıfır çizgisi. Bu sürümde gösterim amaçlıdır; otomatik giriş/çıkış teyidine bağlanmamıştır.

## Kapsam notları

- Kripto spread, hacim ve funding eşikleri KANAL ayarlarında değiştirilebilir; varsayılanlar sırasıyla %0,15, $5M/24 saat ve ±%0,10/fonlama dönemidir. Hacim/notional uygun değilse parite radar öğelerinden çıkarılır.
- MT5 spread 2.5×/bayat fiyat kapısı canlı Python ajanında ve MQL5 EA'da çalışır. Kripto emir defteri filtresi CCXT borsası desteklediği sürece kullanılır; funding endpoint yoksa ceza uygulanamaz.
- Kilit kalıcıdır ve TP/SL fiyat teması veya daha yeni ters yönlü M0 ile temizlenir. Bu reset, gerçek pozisyon kapanış nedenini değil fiyat seviyesine teması izler.
- MQL5 terminal Global Variables kalıcıdır; Windows Python ajan kilidi `%APPDATA%\\JARVIS\\kanal_setup_locks.json` içinde tutulur (APPDATA yoksa ajan klasöründe). Yazma başarısız olursa log uyarısı üretir.

## Kontrol

- `npm run typecheck` ve `npm run build`: başarılı (mevcut NFT tracing uyarısı sürüyor).
- Python dosyaları `py_compile`: başarılı.
- Sentetik RSI sınır testi: RSI 29 → 30 → 31 dizisinde eşik kesişimi tanındı; RSI aşaması `true`.
- `npm run lint`: projede önceden var olan React/ESLint hataları nedeniyle genel lint başarısız; değiştirilen KANAL akışında TypeScript derlemesi başarılı.

---

## v3.5.4 — Electron masaüstü uygulaması (yeni)

- `electron/` klasörü eklendi: JARVIS paneli artık bağımsız masaüstü penceresi olarak çalışıyor (tarayıcı gerekmez).
  - Ana süreç yerel Next.js sunucusunu (`next start`, port `JARVIS_PORT`, varsayılan 3000) arka planda başlatır, hazır olunca pencereyi açar.
  - Pencere kapatılınca sunucu dahil tüm süreçler temiz kapanır (gömülü PGlite/LanceDB dosya kilidi sızıntısı olmaz).
  - Tek örnek kilidi, son pencere boyutu/konum hafızası (electron-store), Türkçe menü, harici bağlantılar sistem tarayıcısında.
  - `.next` yoksa veya sunucu çökerse anlaşılır Türkçe hata kutusu.
- Paketleme: `npm run dist` → Windows NSIS kurulumu / macOS DMG / Linux AppImage (`electron/release/`). PGlite WASM `asarUnpack` ile dışarıda.
- Windows için `PANEL_MASAUSTU.bat`: PANEL_KUR/BASLAT mantığını tekrarlayıp (VERSION kontrolü, yeniden derleme) Electron penceresini başlatır.
- Yeni npm scriptleri: `electron`, `electron:dev` (hot-reload penceresi), `dist`.
- Geliştirme modu: `JARVIS_DEV=http://localhost:3000` verildiğinde Electron harici çalışan `next dev` paneline bağlanır.
