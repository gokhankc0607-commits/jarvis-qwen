# JARVIS Yerel Ajan

| Modül | Görev |
|---|---|
| `mt5_engine.py` | MT5 bağlantısı, fiyat/mum, RSI·CCI·Stoch·ATR, uyumsuzluk, onaylı emir |
| `mql5_compiler.py` | .mq5 oku/yaz, `metaeditor64.exe /compile`, log parse, otonom LLM düzeltme |
| `local_ai.py` | Ollama / LM Studio / OmniRoute (+ opsiyonel bulut), faster-whisper STT, Piper TTS |
| `app.py` | Ana çalıştırıcı: panel senkronu, sesli onay, derleme işçisi, "Jarvis" uyandırma |
| `jarvis_launcher.py` | EXE giriş noktası + kurulum sihirbazı (otomatik MT5 yolu bulma, bağlantı testi) |

## v3.5.0 — KANAL 5 aşaması, risk ve piyasa kalite kapıları

- Ardışık M0 → güvenli 0.10 ATR dönüş → RSI kesişimi → CCI/MA kesişimi; TTL M3/M5 10, M15 8, H1 6 bar; R:R 1:1 altı engellenir.
- MT5 spread ortalaması 2.5× ve bayat fiyat kapıları; kriptoda order-book spread varsayılan %0,15, 24 saat minimum hacim $5M, borsa minimum notional ve ±%0,10 funding eşiği.
- Altcoin sinyallerinde BTC M15 trend çarpanı, TF çakışma kilidi ve uyumlu üst TF bonusu. Setup kilidi yerelde/terminalde kalıcıdır; TP/SL teması veya ters M0 ile sıfırlanır.

## KANAL 5 aşamalı mantık (güncel)

M0'da dış bant kapanışı ve RSI bölgesi aynı kapanmış mumda aranır; daha sonra sırasıyla en az 0.10 ATR güvenli kanal dönüşü, RSI eşiği kesişimi ve CCI/MA kesişimi beklenir. M3/M5 kurulum ömrü 10, M15 8, H1 6 mumdur. SL kurulum ekstremi, TP merkez çizgisidir; R:R 1:1 altı sinyal bloke edilir. MT5 canlı spread/tick kalite kontrolü, üst TF çakışma kilidi ve setup bazlı yinelenme engeli uygulanır. Kriptoda BTC M15 trendi güven puanını etkiler. Güncelleme için panelden güncel ajan paketini alın ve yeniden başlatın.

**Sınırlama:** kripto order-book spread eşiği, hacim/notional gizleme ve funding-rate cezası için eşikler henüz tanımlı olmadığından aktif değildir. Tam durum ve yeniden başlatma davranışı `GUNCELLEME_5_ASAMALI.md` dosyasındadır.

## Python sürümü
MetaTrader5 kütüphanesi yalnızca **64-bit Python 3.6–3.14** için yayınlanır. Derleme betikleri
otomatik olarak **64-bit Python 3.11**'i bulur/kurar (`find_python.bat`); bilgisayardaki diğer
Python sürümlerine dokunmaz. Hata alırsanız `.venv` klasörünü silip tekrar deneyin.

## EN KOLAY YOL
1. Zip'i bir klasöre çıkartın (örn. `C:\JARVIS-Agent`).
2. **`KUR.bat`** dosyasına çift tıklayın — her şeyi otomatik yapar ve `JARVIS-Setup.exe`'yi açar.
3. Kurulumdan sonra masaüstündeki **JARVIS** simgesiyle başlatın.

## Dağıtım paketleri (v3.5.4)

Ayrıntılı rehber: proje kökündeki **`DAGITIM.md`**. Özet:

| Çıktı | Komut |
|---|---|
| Tek dosya `JARVIS.exe` | `python build.py --onefile` |
| Taşınabilir klasör + zip (USB) | `python build.py --portable` |
| Kurulum `JARVIS-Setup.exe` | `python build.py --setup` (Inno Setup 6 gerekir) |
| Panele EXE yükleme (güncelleme) | `python build.py --publish` |
| Açılış testi (EXE'yi çalıştırır) | `python build.py --smoke` |
| **Hepsi** | `python build.py --all` |
| Yalnızca doğrulama + testler | `python build.py --check` (Windows şart değil) |

Hazır `.bat` dosyaları: **`KUR.bat`** (ilk kurulum, her şey) · **`test_build.bat`**
(doğrulama + derleme + gerçek açılış testi) · **`build_exe.bat`** (yalnızca derleme).

**Yöntem A — kendi bilgisayarınızda (önerilen):**
1. Python 3.11 kurun ("Add to PATH" işaretli).
2. (Opsiyonel) Setup.exe için Inno Setup 6: https://jrsoftware.org/isdl.php
3. `test_build.bat` dosyasına çift tıklayın — doğrular, derler, paketler, **çalıştırıp test eder**.
   - Modelleri indirmeden: `build_exe.bat --no-models`

**Yöntem B — GitHub Actions (bilgisayara bir şey kurmadan):**
1. Bu klasörü **private** bir GitHub reposuna push edin (config.json anahtarınızı içerir).
2. Actions → "Build JARVIS EXE" → Run workflow.
3. "JARVIS-Windows" artefaktını indirin (tek EXE + taşınabilir zip + Setup).

## Çalıştırma
- `JARVIS.exe` — ilk açılışta kurulum sihirbazı (config.json eksik/geçersizse)
- `JARVIS.exe --setup` — sihirbazı yeniden aç
- `JARVIS.exe --no-voice` — sessiz mod · `--simulate` — MT5'siz test
- `JARVIS.exe --version` — sürüm · `--selftest` — kendi kendini test (çıkış kodu 0/1)
- `JARVIS.exe --paths` — ayar/veri yolları · `--backups` — yedekler · `--rollback` — son yedeğe dön
- `JARVIS.exe --no-update` — uygulama içi güncellemeyi atla
- Loglar: `%APPDATA%\JARVIS\logs` (taşınabilir modda `JARVIS-Data\logs`)

**Kesin kural:** `place_order(..., approved=True)` yalnızca paneldeki `approved` sinyaller için çağrılır.
Sinyal yalnızca açık bir "Evet" (sesli veya panelde) ile `approved` olur.

## Panel güncellemesi (v2.6)
Panelde grafik / RSI-CCI radarı için ajan artık mum verisi gönderir. Ajanı güncellemek için paneldeki
**Yerel Ajan → JARVIS-Agent.zip** dosyasını indirip yalnızca `app.py` ve `mt5_engine.py` dosyalarını
mevcut klasörünüzün üzerine kopyalayın (`config.json` değişmez), sonra ajanı yeniden başlatın.

## KANAL stratejisi (v2.7)
`kanal_strategy.py` + `mql5/` klasörü: KANAL3BAND bandını kırıp geri dönüş + RSI 70/30 + CCI mor çizgi (CCI MA) kesişimi.
- Ajan, MT5 **Piyasa Gözlemi'nde açık olan tüm pariteleri** seçili zaman dilimlerinde tarar (ayarlar panelde: *KANAL Strateji*).
- 4/4 koşul ilk kez sağlandığında sinyal üretir; JARVIS sesli sorar, yalnızca "Evet" ile emir gider.
- **Ajan güncelleme:** `app.py`, `mt5_engine.py`, `kanal_strategy.py` dosyalarını mevcut klasörün üzerine kopyalayın, ajanı yeniden başlatın.
- **MQL5 dosyaları:** panelde *MQL5 Stratejileri* sayfasında kayıtlıdır; "Derle" ile ajan MetaEditor'da derler
  (`MQL5\\Indicators\\Jarvis\\` ve `MQL5\\Experts\\Jarvis\\` altına yazılır). EA'yı bir grafiğe sürükleyin
  (Algo Trading açık). `InpAutoTrade` varsayılan **false** — yalnızca uyarı verir.
- Centered YSR merkez çizgisi yeniden boyanır; strateji yalnızca kapanmış barlarda sağ uçtaki değerlerle çalışır.

## v2.8 — fiyat akışı, emir doğrulama, güncelleme
- **Canlı fiyat akışı:** ajan her saniye bid/ask gönderir; panel grafiği ve fiyat listesi bununla akar (durum şeridinde "canlı · 0.8 sn").
- **Emir güvenliği:** gönderimden önce Algo Trading, hesap izni, sembol işlem modu, güncel fiyat, SL/TP yönü ve minimum stop mesafesi
  (stops/freeze level + spread) denetlenir. Çok yakın SL/TP otomatik uzatılır; yanlış taraftaki reddedilir. Doldurma modları (IOC/FOK/RETURN)
  sırayla denenir. Red nedeni panelde ve sesli bildirilir; "Tekrar dene" ile yeniden gönderilebilir.
- **Demo/eski sinyaller** gerçek MT5'e asla gitmez; 30 dk'dan eski bekleyen sinyaller süresi dolar.
- **Sembol ekleri** (EURUSD.m, EURUSDm …) otomatik eşlenir.
- **Güncelleme:** `CALISTIR.bat` ile açın → ajan her başlangıçta panelden yeni dosyaları indirir (config.json'a dokunmaz).

## v2.9 — sohbet / sesli emirler, SL-TP değiştirme, broker sembol adları
- **Sohbetten / sesle emir:** "EURUSD 0.1 lot al sl 30 tp 60", "altın sat", "buy gir" (grafikteki parite) → JARVIS özetler, **"Evet"** ile MT5'e gider ve sonucu söyler.
- **SL/TP değiştirme MT5'e gider** (`TRADE_ACTION_SLTP`): "SL girişe çek", "xauusd sl 4150 yap", "tp 80 pip", "sl kaldır", "hepsinin SL girişe çek". İşlemler sayfasında **SL→Giriş** düğmesi.
- **Kapatma:** "NAS100 kapat", "hepsini kapat" (birden çok işlemde onay ister).
- **Broker sembol adları otomatik eşlenir:** US100 → NAS100/USTEC, US30 → DJ30/WS30, XAUUSD → GOLD, EURUSD → EURUSD.m … Bulunamazsa benzer adları önerir.

## v3.0 — Otomatik işlem (isteğe bağlı), yeni SL/TP, girişe çekme
- **Otomatik işlem** (panel → KANAL Strateji → Otomatik İşlem, varsayılan KAPALI): fiyat band içine döndü + RSI + CCI onayı (4/4) ve
  **güven ≥ %80** ise JARVIS sormadan işleme girer; altındaysa yine sorar. Otomatik pozisyonlar ayrı magic (`magic+1`) ve `JARVIS AUTO` yorumuyla açılır.
  Aynı paritede açık pozisyon varsa atlar; en fazla N otomatik pozisyon.
- **Güven puanı:** 45 + 12×kırılan band + RSI gücü (0-10) + CCI–MA farkı (0-5) + risk/ödül (0-5).
- **SL:** ALIŞ → bandın dönüş yaptığı dip, SATIŞ → dönüş tepesi (+0.1×ATR pay); istenirse "bir önceki dip/tepe".
- **TP:** ALIŞ → girişin üstündeki en yakın üst band, SATIŞ → altındaki en yakın alt band.
- **SL girişe çekme:** fiyat TP'ye olan mesafenin %30'unu kâra geçince SL giriş fiyatına çekilir (ayarlanabilir).

## v3.1 — KANAL stratejisi v2 (yeni kural)
- **Zaman dilimleri:** yalnızca 3dk / 5dk / 15dk / 1sa (panelden seçilir).
- **ALIŞ:** mum TÜM alt bantların (en dış bant) dışında KAPANIR → RSI 30 altında → RSI 30'u yukarı keser → CCI mor çizgiyi yukarı keser.
- **SATIŞ:** mum TÜM üst bantların dışında KAPANIR → RSI 70 üstünde → RSI 70'i aşağı keser → CCI mor çizgiyi aşağı keser.
- **SL:** ALIŞ → RSI 30'u yukarı kesmeden önceki en düşük fiyat · SATIŞ → RSI 70'i aşağı kesmeden önceki en yüksek fiyat.
- **TP:** bandın merkez çizgisi (ilk hedef). Otomatik işlem / güven eşiği / %30'da girişe çekme aynen çalışır.
- **EA:** `mql5/KANAL_Strateji.mq5` v3.10 aynı kuralla; girişlerden M3/M5/M15/H1 seçilir, Piyasa Gözlemi taranır.
- **Güven:** 60 + bant dışı derinlik (0-10) + RSI aşırılığı (0-15) + CCI–MA farkı (0-5) + risk/ödül (0-10).

## v3.1.1 — düzeltmeler
- **`cublas64_12.dll` hatası:** bilgisayarda NVIDIA GPU var ama CUDA 12 kütüphaneleri yoksa ses tanıma artık otomatik **CPU**'ya geçer
  (açılışta test edilir; çalışırken hata olursa da geçer). GPU için: `.venv\Scripts\pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"`.
- **Ses döngüsü çökmez:** hata olursa kaydedilir ve devam eder; üst üste 5 hatada dinleme kapanır, onaylar panelden verilir.
- **Ajan anahtarı:** panel anahtarı reddederse (401) açık uyarı verilir ve kurulum penceresi kendiliğinden açılır.
- **Panel verileri** artık `%APPDATA%\JARVIS\jarvis.db.tgz` içinde (proje klasöründen bağımsız). Eski klasörlerdeki veri ilk açılışta otomatik kopyalanır.

## v3.2 — geri dönüş şartı, yarı kâr al, takip listesi, işlem zaman dilimi
- **Strateji:** bant dışı kapanış sonrası fiyat **bantların içine dönmeden** işlem açılmaz (5 koşul). RSI/CCI kesişimi en fazla 10 mum önce
  olabilir ve şu an hâlâ onaylı olmalı; sinyal genelde içeri dönüş mumunda çıkar.
- **Yarı kâr al:** fiyat TP yolunun %50'sine ulaşınca lotun yarısı kapatılır (ayarlanabilir). %30'da SL girişe. JARVIS'in açtığı tüm işlemlerde
  (sinyal onayı, hızlı emir, otomatik) çalışır. Panelde "½ Kapat", sohbette "yarısını kapat".
- **Takip listesi:** strateji yalnızca seçtiğin pariteleri tarar (Panel → Takip Listesi). İstenirse Piyasa Gözlemi'nin tamamı.
- **İşlem zaman dilimi:** emir yorumu artık TF içerir ("JARVIS BUY M15 #12", "JARVIS AUTO M5"); panelde her işlemin TF'si görünür.

## v3.2.1 — işlem zaman dilimi düzeltmesi
- Zaman dilimi artık MT5 yorumuna bağlı değil (brokerlar yorumu silebiliyor): ajan açtığı her pozisyonun TF'sini `tf_map.json`'a kaydeder
  ve panele bildirir. Ek yedekler: bilet numarası → sinyal, yorum ("KANAL BUY PERIOD_M15" dahil), #sinyal numarası.
- MT5'te elle açılan işlemlerde TF bilinemez: İşlemler sayfasında "＋TF"ye tıklayıp elle atayabilirsiniz.

## v3.3 — Telegram bot + Piyasa & Grafik zaman dilimi seçimi
- **Telegram** (Panel → Telegram Bot): bot token + chat ID. Sinyal geldiğinde bildirim: hangi kanala temas ettiği / kanal taşması,
  o anki RSI durumu (değer + aşırı alım/satım notu), CCI/mor çizgi, giriş-SL-TP ve R:R. Düğmeler: ✅ Evet gir / ❌ Hayır / 📊 Panelde aç / 🔕 30 dk sessiz.
  Düğmelerin çalışması için ajan açık olmalı (ajan `getUpdates` ile dinler, eylemi panele iletir; işlem kuralları aynen uygulanır).
- **Piyasa & Grafik → Zaman Dilimi:** seçtiğin dil bütün paritelere uygulanır (fiyat, değişim, RSI, grafik, radar). “Tümü” ile eski hâle dönülür.

## v3.4 — Kripto borsası (Binance vadeli DEMO)
- **Panel → Kripto Borsası:** Binance USDⓈ-M vadeli, varsayılan **Demo Trading** (test ağı, gerçek para yok). Demo anahtarı:
  demo.binance.com → API Management. Ajan `ccxt` ile bağlanır (`enable_demo_trading`), anahtarlar yalnız ajana gider.
- **Aynı KANAL stratejisi** borsa mumlarında çalışır; kripto pariteleri Takip Listesi → “Kripto” bölümünden seçilir (BTC yazmak yeterli → BTCUSDT).
- **İşlem büyüklüğü:** lot yerine işlem başına USDT teminatı × kaldıraç. SL/TP borsada koruma emirleri (STOP_MARKET / TAKE_PROFIT_MARKET,
  closePosition). %30 girişe çekme, %50 yarı kâr, kapatma aynen çalışır.
- **Sohbet/sesli:** “btc kripto al” → borsa · “btc forexten al” → MT5 · piyasa söylenmezse ve parite iki yerde de varsa JARVIS **sorar**.
  Yalnızca tek yerde varsa (EURUSD → forex, ETHUSDT → kripto) sormadan oraya gider.
- **Telegram:** her bildirimin başında 🪙 KRİPTO / 💱 FOREX etiketi.
- İşlemler, sinyaller ve komutlar `market` alanı taşır; panelde 🪙 rozeti.

## v3.4.1 — kripto görünürlüğü ve arayüz
- Kripto takip listesi artık Piyasa Özeti / Piyasa & Grafik'te görünür (forex ile ayrı: BTCUSD MT5, BTCUSDT borsa).
- Komuta Merkezi: MT5 kutusunun yanında **KRİPTO BORSASI** kutusu (BINANCE DEMO · cüzdan, varlık, kaldıraç).
- Piyasa & Grafik: üstte **FOREX / KRİPTO** sekmeleri; grafiğin altında açık işlemler paneli (½ Kapat · SL→Giriş · ✎ SL/TP · Kapat).
- Ajan: kripto ve forex fiyat akışı / mum serileri ayrı anahtarlarla gönderilir (src=crypto).

## v3.4.2 — Panel
- Piyasa & Grafik → **KANAL Radar**: eski RSI/CCI uyum tablosu yerine KANAL stratejisinin 5 koşulu (bant dışı → RSI bölge → **bant içine dönüş** → RSI kesişimi → CCI kesişimi). AL/SAT yalnızca 5/5'te.
- Varsayılan kripto takip listesi: BTC, ETH, BNB, SOL, XRP, AVAX, SUI, APT, LINK, FET, RENDER, TAO, GRT, NEAR (USDT vadeli). Liste bir kez doldurulur; silerseniz geri gelmez.

## v3.5.4 — tek EXE, taşınabilir sürüm, uygulama içi güncelleme

**Dağıtım**
- **Tek dosya EXE** (`jarvis_onefile.spec`): `dist\JARVIS-Portable\JARVIS.exe` — çift tıkla çalışır.
  Klasör sürümü (`jarvis.spec`) hızlı açılış için duruyor: `python build.py --onedir`.
- **Taşınabilir sürüm**: yanındaki `portable.txt` ile ayarlar `config.json`, veriler
  `JARVIS-Data\` içinde tutulur; `%APPDATA%` kullanılmaz, USB'den çalışır.
- **Setup.exe**: sürüm EXE'den okunur, `config.json` **ezilmez** (`onlyifdoesntexist`),
  kaldırırken veriler korunur (isteğe bağlı silme sorusu).
- **`build.py`**: tek komutla doğrulama (`--check`), derleme, paketleme, yayınlama,
  açılış testi (`--smoke`) ve zip. CI (`ci/build-agent.yml`) aynı adımları Windows'ta koşar.

**Uygulama içi güncelleme**
- Ajan artık **EXE'nin kendisini** günceller: paneldeki `/api/agent/exe-manifest` sürümü
  daha yüksekse yeni EXE indirilir, SHA-256 doğrulanır, `JARVIS.exe` → `.old`,
  `.new` → `JARVIS.exe`, ardından yeni sürüm ayrı süreçte başlatılır.
- Açık işlem varken değişiklik diske yazılır ama yeniden başlatma ertelenir.
- Dosya güncellemelerinde de kural aynı: özet uyuşmazsa **hiçbir dosya yazılmaz**,
  her güncellemeden önce yedek alınır (`--rollback` ile geri dönülür).
- Panel tarafı: `/api/agent/exe-manifest` ve `/api/agent/exe` (yalnızca ajan anahtarıyla;
  dosya `agent-dist\` içinde, `public\` altında değil).

**Yollar (`jarvis_paths.py`)**
- Ayarlar her zaman EXE'nin yanında; loglar, yedekler ve KANAL kurulum kilitleri
  `%APPDATA%\JARVIS` (taşınabilir modda `JARVIS-Data`, `JARVIS_HOME` ile geçersiz kılınabilir).
- Böylece Setup.exe güncellense, klasör taşınsa ya da USB'ye kopyalansa bile
  ayarlar ve veritabanı aynı kalır.

**Testler**
- `tests/` altında 25 birim testi: sahte panel sunucusuyla gerçek indirme, özet doğrulama,
  atomik EXE değişimi, yedek/geri alma, taşınabilir-yol çözümleme, sürüm karşılaştırma.
- `python tests/run_tests.py -v` (standart kütüphane + requests yeterli).
