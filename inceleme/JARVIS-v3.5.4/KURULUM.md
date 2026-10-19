# JARVIS — Windows'ta Kurulum

## 1) Komuta Merkezi (panel) — http://localhost:3000
1. Bu klasörde **`PANEL_KUR.bat`** dosyasına çift tıklayın (ilk sefer).
   - Node.js yoksa kurar. **PostgreSQL GEREKMEZ** — gömülü veritabanı (`data\jarvis.db.tgz`) kullanılır.
2. Tarayıcı açılır: **http://localhost:3000** → `demo@jarvis.local` / `jarvis123`
3. Sonraki açılışlarda sadece **`PANEL_BASLAT.bat`**.
4. **Masaüstü penceresi (Electron, v3.5.4):** tarayıcı yerine bağımsız pencere için
   **`PANEL_MASAUSTU.bat`** — ilk seferde Electron bağımlılıklarını kurar, paneli arka
   planda çalıştırır; pencere kapanınca sunucu da kapanır. Installer üretimi:
   `npm run dist` → `electron\release\` (NSIS `.exe` / DMG / AppImage). Ayrıntı: `electron\README.md`.

> Harici PostgreSQL kullanmak isterseniz `.env.local` içine
> `DATABASE_URL=postgresql://kullanici:sifre@127.0.0.1:5432/jarvis` yazın ve `npx drizzle-kit push` çalıştırın.

## 2) Yerel Ajan (JARVIS.exe) — MT5 + ses + derleyici
1. Panelde **Yerel Ajan** → **⬇ JARVIS-Agent.zip** (Panel URL otomatik `http://localhost:3000` olur).
2. Zip'i çıkartın → **`KUR.bat`**.
   - **v3.5.4:** `KUR.bat` / `test_build.bat` artık **tek dosya JARVIS.exe**, **taşınabilir zip**
     ve **JARVIS-Setup.exe** üretir; derleme sonrası EXE'yi gerçekten çalıştırıp test eder.
   - Ajan açılışta panelden kendisini günceller (`.py`/`.mq5` **ve** `JARVIS.exe`);
     `config.json` ve veriler korunur. Ayrıntı: **`DAGITIM.md`**.

## Veriler / yedek
Tüm panel verileri tek dosyadadır: `data\jarvis.db.tgz` (bir önceki oturum: `.bak`). Yedek için bu dosyayı kopyalayın.

## Güncelleme (baştan kurmak gerekmez)
- **Panel:** yeni dosyaları eski klasörün üzerine çıkartın. `data\` (veriler) ve `.env.local` projede olmadığı için silinmez.
  Sonra `PANEL_BASLAT.bat` — `VERSION` değiştiyse kendisi yeniden derler (npm paketlerini de günceller).
- **Ajan:** `CALISTIR.bat` ile açın; ajan her başlangıçta panelden yeni dosyaları indirir, `config.json`'a dokunmaz.
  EXE kullanıyorsanız güncelleme paketini çıkartıp `build_exe.bat --no-models` çalıştırın.
- Güncelleme paketi: panel → Yerel Ajan → "Güncelleme paketi (config.json içermez)".

## Sohbet / sesli komutlar (v2.9)
- Emir: `EURUSD 0.1 lot al sl 30 tp 60` · `altın sat` · `buy gir` → JARVIS özetler, **Evet** deyince MT5'e gider.
- SL/TP: `SL girişe çek` · `xauusd sl 4150 yap` · `tp 80 pip` · `sl kaldır` · `hepsinin SL girişe çek`
- Kapat: `NAS100 kapat` · `hepsini kapat` (onay ister) · Durum: `durum`

## Otomatik işlem (v3.0)
Panel → **KANAL Strateji** → **Otomatik İşlem** anahtarı (varsayılan kapalı). Açıkken: 4/4 koşul + güven ≥ %80 → JARVIS sormadan girer,
SL = dönüş dibi/tepesi, TP = en yakın karşı band, fiyat TP yolunun %30'unu geçince SL girişe çekilir. Ajan v3.0 gerekir (CALISTIR.bat otomatik günceller).

## KANAL stratejisi v2 (v3.1)
Tüm bantların dışında kesin kapanış + RSI 30/70 kesişimi + CCI mor çizgi kesişimi. SL = RSI kesişiminden önceki dip/tepe,
TP = merkez çizgi. Zaman dilimleri: 3dk / 5dk / 15dk / 1sa (KANAL Strateji sayfasından). Ajan v3.1 gerekir (CALISTIR.bat günceller).
EA kullanıyorsanız `KANAL_Strateji.mq5`'i MQL5 Stratejileri sayfasından yeniden derleyin.

## Veriler nerede? (v3.1.1)
Panel verileri `%APPDATA%\JARVIS\jarvis.db.tgz` dosyasındadır — paneli yeni bir klasöre çıkartsanız da aynı veriler ve aynı ajan anahtarı kullanılır.
İlk açılışta eski klasörlerdeki (`...\data\jarvis.db.tgz`) en yeni veri otomatik kopyalanır. Yedek: bu dosyayı kopyalayın.

## v3.2
- **Takip Listesi** (kenar menü): KANAL yalnızca buradaki pariteleri tarar.
- **Yarı kâr al:** TP yolunun %50'sinde lotun yarısı kapatılır (KANAL Strateji → Kâr yönetimi). İşlemler sayfasında "½ Kapat".
- **Kenar menü** tüm sayfalarda; « / » ile daraltılıp genişletilir.
- Ajan v3.2 gerekir (CALISTIR.bat otomatik günceller). EA kullanıyorsanız KANAL_Strateji.mq5'i yeniden derleyin.

## Kripto (v3.4)
1. demo.binance.com'da demo hesabı aç → API Management → anahtar oluştur (Futures işlem izni).
2. Panel → **Kripto Borsası**: borsa Binance, ortam **Demo**, anahtarları kaydet, **Aç**.
3. Takip Listesi → Kripto bölümüne BTC, ETH… ekle. Ajanı `CALISTIR.bat` ile yeniden başlat (ccxt kurulur, v3.4).
4. Sohbet: "btc kripto al" / "btc forexten al"; söylemezsen JARVIS sorar.

## Dağıtım (v3.5.4)

* **Tek EXE / taşınabilir / Setup.exe** üretimi, **uygulama içi güncelleme**, **yedek & geri alma**
  ve **açılış testleri** → **`DAGITIM.md`**.
* Ajan komutları: `JARVIS.exe --version · --selftest · --paths · --backups · --rollback · --no-update`
* Ajan yeni EXE'yi panelin `agent-dist\JARVIS.exe` dosyasından alır; panele yüklemek için
  `cd public\agent && python build.py --onefile --publish`.
