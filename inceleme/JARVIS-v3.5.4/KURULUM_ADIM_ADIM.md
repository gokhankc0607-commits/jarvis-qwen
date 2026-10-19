# JARVIS — Adım Adım Kurulum (v3.5.4)

Sıfırdan çalışan bir JARVIS'e kadar **tek tek** anlatım. Toplam süre: ~10 dakika
(panel) + ~5 dakika (ajan, kaynak mod) ya da ~20 dakika (EXE derleme, ilk kez).

---

## 0 · Önce şunu bilin: JARVIS iki parçadır

```
┌─────────────────────────┐          ┌──────────────────────────┐
│  PANEL (Komuta Merkezi) │  ◄─────► │  AJAN (yerel program)    │
│  Next.js · tarayıcı     │  HTTP    │  Python · Windows        │
│  http://localhost:3000  │  yerel   │  MT5 + ses + derleyici   │
│  Grafik, emir, sohbet   │          │  Emirleri MT5'e gönderir │
└─────────────────────────┘          └──────────────────────────┘
        veriler burada                     MT5 terminali burada
   %APPDATA%\JARVIS\jarvis.db.tgz
```

İkisi **ajan anahtarı** (`jrv_...`) ve **panel URL** ile konuşur. Panel açık olmadan
ajan çalışır ama emir/veri akışı olmaz. **Önce paneli, sonra ajanı kurun.**

---

## 1 · Hangi yolu seçmeliyim?

| Amacınız | Panel | Ajan |
|---|---|---|
| **Hızlı deneyeyim** | `PANEL_KUR.bat` | Panelden indirdiğiniz zip → **`CALISTIR.bat`** |
| **Tarayıcı yerine masaüstü penceresi** | **`PANEL_MASAUSTU.bat`** (Electron) | Panelden indirdiğiniz zip → **`CALISTIR.bat`** |
| **Tek EXE / kurulum paketi olsun** | `PANEL_KUR.bat` | **`test_build.bat`** → `JARVIS.exe` + `JARVIS-Setup.exe` |
| **Birden fazla PC'ye kuracağım** | `PANEL_KUR.bat` | `Setup.exe` (veya taşınabilir zip'i USB'ye atın) |
| **Bilgisayarıma hiçbir şey kurmadan EXE** | `PANEL_KUR.bat` | GitHub Actions (`ci/build-agent.yml`) |

---

## 2 · Hazırlık

### Gerekenler

| Gereksinim | Zorunlu mu? | Kim kuruyor |
|---|---|---|
| Windows 10/11 **64-bit** | ✅ | — |
| **MetaTrader 5** terminali kurulu | ✅ (işlem için) | siz |
| Node.js **20.9+** | ✅ panel için | `PANEL_KUR.bat` otomatik |
| Python **3.10–3.12 64-bit** | ✅ ajan için | `find_python.bat` otomatik (3.11 önerilir) |
| Inno Setup 6 | ❌ yalnızca `Setup.exe` için | `KUR.bat` otomatik |
| Ollama (yerel yapay zekâ) | ❌ isteğe bağlı | `KUR.bat` sorarak |
| İnternet | ✅ ilk kurulumda | — |

> **Python sürümü neden kısıtlı?** `MetaTrader5` paketi yalnızca `win_amd64` ve
> 3.10/3.11/3.12 için yayınlanıyor. 3.13+ desteklenmiyor.

### ZIP'i açın

1. `JARVIS-v3.5.4-kaynak.zip` dosyasını bir klasöre çıkartın — örn. **`C:\JARVIS`**.
2. Klasörde şunları göreceksiniz:
   ```
   C:\JARVIS\
   ├─ PANEL_KUR.bat        ← panel ilk kurulum
   ├─ PANEL_BASLAT.bat     ← paneli açar (bundan sonra hep bu)
   ├─ PANEL_MASAUSTU.bat   ← paneli Electron masaüstü penceresi olarak açar
   ├─ electron\            ← Electron ana süreci (main.js, README.md)
   ├─ KURULUM.md  DAGITIM.md  KURULUM_ADIM_ADIM.md
   ├─ VERSION              ← 3.5.4
   └─ public\agent\        ← ajan (Python) — KUR.bat, CALISTIR.bat, build_exe.bat…
   ```
3. **Klasör adında Türkçe karakter/boşluk olmasın** (`C:\JARVIS` ideal).

---

## 3 · PANEL kurulumu

### Adım 3.1 — `PANEL_KUR.bat`'a çift tıklayın

Bu betik sırayla şunları yapar, siz sadece bekleyin:

1. **Node.js kontrolü** — yoksa `winget` ile Node.js LTS kurar.
   Kurulumdan sonra **pencereyi kapatıp betiği tekrar çalıştırmanız** gerekebilir
   (PATH yeni pencerede güncellenir).
2. **Veritabanı ayarı** — `.env.local` dosyasına `DATABASE_URL=pglite:shared` yazar.
   **PostgreSQL kurmanız gerekmez**; veritabanı panelin içinde gömülüdür ve
   `%APPDATA%\JARVIS\jarvis.db.tgz` dosyasında tutulur.
3. **Paketler + derleme** — `npm install` ve `npm run build`. İlk seferde 2–5 dakika sürer.
4. **Başlatma** — `PANEL_BASLAT.bat`'ı çağırır.

### Adım 3.2 — Tarayıcıda açın

Betiğin sonunda tarayıcı kendiliğinden **http://localhost:3000** adresini açar
(açılmazsa siz yazın).

### Adım 3.3 — Giriş yapın

```
E-posta : demo@jarvis.local
Şifre   : jarvis123
```

İsterseniz "Hesap oluştur" ile kendi hesabınızı da kurabilirsiniz.

### Adım 3.4 — Panel açık kalsın

Bu siyah pencere **panelin kendisi**; kapatırsanız ajan bağlantısı kesilir
(ajan çalışmaya devam eder, panel geri gelince bağlanır). Durdurmak için `CTRL+C`.

### Adım 3.5 — Sonraki açılışlar

Bundan sonra sadece **`PANEL_BASLAT.bat`**. Yeni sürüme geçtiğinizde `VERSION`
değiştiyse panel **kendini otomatik yeniden derler**.

### Adım 3.6 — Masaüstü penceresi olarak açmak (Electron, opsiyonel)

Tarayıcı sekmesi yerine bağımsız bir **JARVIS masaüstü penceresi** isterseniz
**`PANEL_MASAUSTU.bat`**'a çift tıklayın:

1. İlk çalıştırmada Electron bağımlılıklarını kendisi kurar (bir kez).
2. `PANEL_KUR.bat` mantığını tekrarlar (VERSION değiştiyse yeniden derler).
3. Yerel panel sunucusunu arka planda başlatıp pencereyi açar; **pencereyi
   kapattığınızda sunucu da tamamen kapanır** (arka planda node kalmaz).

Ayrıntı / installer üretimi (`npm run dist` → NSIS `.exe`, DMG, AppImage):
`electron\README.md`.

---

## 4 · Ajan anahtarını alın

1. Panelde sol menüden **Yerel Ajan** sayfasını açın.
2. **Ajan Anahtarı** kutusundaki `jrv_...` ile başlayan anahtarı görün.
   Gerekirse **"Yenile"** ile yeni anahtar üretin.
3. Bu anahtarı kopyalayın — ajan bununla panele kimliğini kanıtlar.

> Paneli yeni bir klasöre kurarsanız veritabanı (ve anahtar) **aynı kalır**;
> çünkü veriler `%APPDATA%\JARVIS` içinde, proje klasöründe değil.

---

## 5 · AJAN kurulumu — Yol A: Kaynak koddan (önerilen, en hızlı)

Güncellemeler otomatik geldiği için günlük kullanımda en rahat yöntem budur.

### Adım 5.1 — Ajan paketini indirin
Panel → **Yerel Ajan** → **⬇ JARVIS-Agent.zip**.
Bu zip'in içindeki `config.json`'a **panel adresiniz ve ajan anahtarınız gömülüdür**;
elle bir şey yazmanız gerekmez.

### Adım 5.2 — Çıkartın
Örn. **`C:\JARVIS-Agent`**.

### Adım 5.3 — `CALISTIR.bat`'a çift tıklayın
1. Varsa uygun Python'u bulur, yoksa **Python 3.11 64-bit** kurar.
2. `.venv` sanal ortamını kurar, paketleri indirir (ilk seferde 2–5 dk).
3. Ajanı başlatır.

### Adım 5.4 — Kurulum sihirbazı (ilk açılışta)
Sihirbaz kendiliğinden açılır ve şunları **otomatik bulur**:
- `terminal64.exe` (MT5)
- `metaeditor64.exe` (MQL5 derleyici)
- `MQL5` klasörü
- Yerel yapay zekâ (Ollama/LM Studio) varsa onu

**"Bağlantıları Test Et"** → sonra **"Kaydet ve Başlat ▶"**.
Ayarlar `C:\JARVIS-Agent\config.json` dosyasına yazılır.

### Adım 5.5 — Doğrulayın
Konsolda panel bağlantısının kurulduğunu, panelde **Komuta Merkezi**'nde ajanın
yeşile döndüğünü görürsünüz. Kaynak modda ajan **her açılışta panelden kendini günceller**
(`config.json`'a dokunmaz).

---

## 6 · AJAN kurulumu — Yol B: Tek EXE + Setup.exe

Başlat menüsü, masaüstü kısayolu, taşınabilir sürüm istiyorsanız bu yol.

### Adım 6.1 — Ajan paketini indirin ve çıkartın
Aynı şekilde: Panel → **Yerel Ajan** → **⬇ JARVIS-Agent.zip** → `C:\JARVIS-Agent`.

### Adım 6.2 — `test_build.bat`'a çift tıklayın
Sırayla şunları yapar ve **her adımda durup sonucu gösterir**:

| Adım | Ne olur |
|---|---|
| `[1/5]` | Statik doğrulamalar + **25 birim testi** (sürüm uyumu, simgeler, yollar) |
| `[2/5]` | PyInstaller ile **tek dosya** `dist\JARVIS.exe` üretir |
| `[3/5]` | **Taşınabilir** klasör + zip hazırlar |
| `[4/5]` | EXE'yi **gerçekten çalıştırıp** test eder (`--version`, `--selftest`) |
| `[5/5]` | EXE'yi panelin dağıtım klasörüne kopyalar (`agent-dist`) |

Yalnızca derlemek isterseniz `build_exe.bat` (modelleri atlamak için `build_exe.bat --no-models`).

> **`'hcp' is not recognized` gibi hatalar alırsanız:** `.bat` dosyası Unix satır sonlu (LF) kalmış demektir;
> cmd.exe her satırın ilk harfini yutar. **`SATIR_SONU_DUZELT.bat`**'ı çalıştırıp tekrar deneyin.

### Adım 6.3 — Çıktılar
```
C:\JARVIS-Agent\dist\
├─ JARVIS.exe                       ← tek dosya (PyInstaller onefile)
├─ JARVIS-Portable\                 ← EXE + portable.txt + JARVIS-Data + ses modelleri
│   └─ JARVIS.exe
├─ JARVIS-Portable-v3.5.4.zip       ← USB'ye atın, başka PC'de açılır
├─ JARVIS-Setup.exe                 ← kurulum (Inno Setup kuruluysa)
└─ JARVIS-Windows-v3.5.4.zip        ← hepsi bir arada
```

### Adım 6.4 — Kurun
**Kurulum:** `JARVIS-Setup.exe` → İleri → Kur. `%LOCALAPPDATA%\JARVIS` altına kurulur,
yönetici izni istemez. Masaüstü + Başlat menüsü kısayolları gelir.
**Taşınabilir:** `JARVIS-Portable` klasörünü USB'ye kopyalayıp `JARVIS.exe`'yi açın.

### Adım 6.5 — Açın
Kısayoldan (veya `JARVIS.exe`) açın. İlk açılışta **kurulum sihirbazı** gelir
(Yol A'daki ile aynı). Sonra `JARVIS.exe --selftest` ile kontrol edebilirsiniz.

### ⚠ Önemli ayrıntı
Eğer derlemeyi **panel projesinin içindeki** `public\agent` klasöründe yaptıysanız
(`C:\JARVIS\public\agent`), `--publish` EXE'yi doğrudan `C:\JARVIS\agent-dist\`
içine yazar ve **panel ajanlara otomatik dağıtır**.

Eğer derlemeyi **indirdiğiniz ayrı ajan klasöründe** yaptıysanız (`C:\JARVIS-Agent`),
`agent-dist\` klasörünü panel projesinin köküne (`VERSION` dosyasının yanına,
yani `C:\JARVIS\agent-dist\`) **elle kopyalayın** — aksi halde panel yeni EXE'yi
bulamaz (`build.py` bunu çıktıda size hatırlatır).

---

## 7 · AJAN kurulumu — Yol C: GitHub Actions (bilgisayara hiçbir şey kurmadan)

1. `public\agent` klasörünün içeriğini **private** bir GitHub reposuna push edin
   (`config.json` ajan anahtarınızı içerir — repo **kesinlikle gizli** olsun, ya da
   `config.json`'u silin).
2. GitHub'da **Actions → "Build JARVIS EXE" → Run workflow**.
3. ~10 dakika sonra **"JARVIS-Windows"** artefaktını indirin:
   `JARVIS-Setup.exe` + taşınabilir klasör + zip.
4. İndirdiğiniz `JARVIS.exe`'yi açın → kurulum sihirbazı → panel URL ve anahtarı girin.

> Actions iş akışı doğrulamaları, birim testlerini ve **açılış testini** de koşar;
> bir adım kırmızı olursa artefakt üretilmez.

---

## 8 · İlk çalıştırma ve kontrol

Ajan açıldığında konsolda şu sırayı görürsünüz:

1. **Sürüm ve güncelleme** — panelden yeni dosya/EXE varsa indirir, uygular, yeniden başlar.
2. **Panel ön kontrolü** — `ok` / `badkey` / `down`.
3. **MT5 bağlantısı** — terminal açılır, hesap bilgisi gelir.
4. **KANAL taraması** — takip listesindeki pariteler taranır.

### Komutlar

| Komut | Ne yapar |
|---|---|
| `JARVIS.exe --version` | Sürümü yazar, çıkar |
| `JARVIS.exe --selftest` | Yol, yedek, modül ve panel kontrolü (çıkış kodu 0/1) |
| `JARVIS.exe --setup` | Kurulum sihirbazını yeniden açar |
| `JARVIS.exe --paths` | Ayarların ve verilerin nerede olduğunu gösterir |
| `JARVIS.exe --backups` | Yedekleri listeler |
| `JARVIS.exe --rollback` | Son yedeğe döner (güncelleme bozulursa) |
| `JARVIS.exe --no-voice` | Ses kapalı |
| `JARVIS.exe --no-update` | Güncellemeyi atlar |

### Nerede ne duruyor?

| Veri | Yer |
|---|---|
| Ajan ayarları | `config.json` — **EXE'nin yanında** |
| Ajan logları, yedekler, KANAL kilitleri | `%APPDATA%\JARVIS` (taşınabilir modda `JARVIS-Data`) |
| Panel veritabanı | `%APPDATA%\JARVIS\jarvis.db.tgz` (+ `.bak`) |
| Panel logları | konsol penceresi |

---

## 9 · İlk işleme kadar (dikkat!)

1. **Otomatik işlem varsayılan olarak KAPALIDIR.** Açmak için:
   Panel → **KANAL Strateji** → **Otomatik İşlem**.
   Açıkken 4/4 koşul + güven ≥ %80 olmadan işlem açmaz.
2. **Takip listesi** — KANAL yalnızca buradaki pariteleri tarar (Panel → Takip Listesi).
3. **Demo hesapla başlayın.** MT5'te demo hesap açıp sihirbazda o hesabı seçin.
4. Sohbetten emir vermek için: `EURUSD 0.1 lot al sl 30 tp 60` — JARVIS özetler,
   siz **"Evet"** deyince MT5'e gider. Onay olmadan emir gitmez.
5. Telegram bildirimi isterseniz: Panel → **Telegram** → bot token'ı girin → Test.
6. Telefondan erişim: Panel → **Ayarlar → Telefon (QR)** — telefon ve PC aynı Wi-Fi'da olmalı.

---

## 10 · Güncelleme

### Panel
1. Yeni ZIP'i **eski klasörün üzerine** çıkartın (`data\` ve `.env.local` silinmez).
2. `PANEL_BASLAT.bat` — `VERSION` değiştiyse **kendini yeniden derler**.
3. Veritabanı `%APPDATA%\JARVIS` içinde olduğu için **hiçbir veri kaybolmaz**.

### Ajan (kaynak mod — `CALISTIR.bat`)
Ek bir şey yapmanız gerekmez: ajan her açılışta panelden yeni dosyaları indirir.

### Ajan (EXE)
Ajan açılışta panelde yeni bir `JARVIS.exe` varsa **kendini günceller**.
Panelde EXE yoksa konsolda *"panelde derlenmiş JARVIS.exe yok"* yazar ve devam eder.
Panele yeni EXE yüklemek için:

```bat
cd C:\JARVIS\public\agent
python build.py --onefile --publish
```

### Bir şey bozulursa
```bat
JARVIS.exe --backups     :: yedekleri gör
JARVIS.exe --rollback    :: son yedeğe dön
```

---

## 11 · Sık karşılaşılan sorunlar

| Belirti | Sebep / Çözüm |
|---|---|
| *"winget bulunamadı"* | Microsoft Store'dan **App Installer** kurun; ya da Node/Python'u elle kurun |
| *"Node.js çok eski"* | En az **v20.9** gerekir → https://nodejs.org (LTS) |
| *"Node.js kuruldu ama pencere görmüyor"* | Pencereyi kapatıp `PANEL_KUR.bat`'ı **tekrar** çalıştırın |
| Panel açılmıyor, port dolu | 3000 portunu başka program kullanıyor; eski panel penceresini kapatın |
| *"AJAN ANAHTARI GEÇERSİZ (401)"* | Panel → Yerel Ajan → anahtarı kopyalayın → `JARVIS.exe --setup` |
| *"PANELE ULAŞILAMADI"* | `PANEL_BASLAT.bat` penceresi açık mı? Ajan yine de çalışır, bağlanmayı dener |
| *"MetaTrader5 import edilemiyor"* | 64-bit Python 3.10–3.12 kullanın; 3.13 desteklenmiyor |
| `JARVIS.exe` geç açılıyor (2–5 sn) | Tek dosya sürümün normal davranışı; hızlısı için `build.py --onedir` |
| Setup.exe üretilmedi | Inno Setup 6 kurulu mu? https://jrsoftware.org/isdl.php |
| *"panelde derlenmiş JARVIS.exe yok"* | `python build.py --onefile --publish` (bkz. Adım 6.5'teki ⚠ not) |
| Ses çalışmıyor | `pip install -r requirements-voice.txt`; olmadan da çalışır (Windows sesine düşer) |
| **`'hcp'` / `'etlocal'` / `'cho.'` / `'all'` is not recognized** | `.bat` dosyası **LF (Unix)** satır sonlu; cmd.exe her satırın ilk harfini yutar → **`SATIR_SONU_DUZELT.bat`** çalıştırın, sonra `build_exe.bat`'ı tekrar deneyin |
| MT5 bulunamadı | Sihirbazda `terminal64.exe` yolunu elle gösterin |

---

## 12 · Hızlı özet (kopyalanabilir)

```bat
:: 1) PANEL — bir kez
cd C:\JARVIS
PANEL_KUR.bat
::    → http://localhost:3000  →  demo@jarvis.local / jarvis123

:: 2) AJAN — paketi panelden indir (Yerel Ajan → ⬇ JARVIS-Agent.zip), sonra:
::    kaynak mod (günlük kullanım)
cd C:\JARVIS-Agent
CALISTIR.bat

::    ya da tek EXE + Setup
cd C:\JARVIS-Agent
test_build.bat
dist\JARVIS-Setup.exe

:: 3) KONTROL
JARVIS.exe --version
JARVIS.exe --selftest
```
