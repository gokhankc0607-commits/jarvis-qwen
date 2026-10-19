# JARVIS — Dağıtım Rehberi (v3.5.4)

Bu belge **tek EXE**, **taşınabilir sürüm**, **Setup.exe**, **uygulama içi güncelleme**
ve **ayar/veritabanı korunması** konularını anlatır. Panel kurulumu için `KURULUM.md`.

---

## 1. Üç paket, üç kullanım

| Paket | Dosya | Ne zaman |
|---|---|---|
| **Tek EXE** | `dist\JARVIS-Portable\JARVIS.exe` | Çift tıkla, çalışır. Kurulum yok, iz bırakmaz. |
| **Taşınabilir** | `dist\JARVIS-Portable-v3.5.4.zip` | USB'ye at, başka bilgisayarda aç. |
| **Kurulum** | `dist\JARVIS-Setup.exe` | Başlat menüsü + masaüstü kısayolu + kaldırıcı. |

Üçü de **aynı** `config.json` mantığını kullanır; birinden diğerine geçişte ayarlar korunur.

### Tek dosya (onefile) vs klasör (onedir)

* **Tek dosya** (varsayılan): `jarvis_onefile.spec` → tek `JARVIS.exe`.
  Her açılışta kendini geçici klasöre açar; **ilk açılış 2–5 saniye** sürer.
* **Klasör** (hızlı açılış): `jarvis.spec` → `dist\JARVIS\` içinde onlarca `.dll`.
  Açılışı belirgin şekilde daha hızlıdır; tek dosya olarak taşınamaz.

```bat
python build.py --onefile     :: tek dosya   (dist\JARVIS.exe)
python build.py --onedir      :: klasör      (dist\JARVIS\JARVIS.exe)
```

---

## 2. Windows'ta derleme (tek komut)

```bat
cd public\agent
KUR.bat          :: ilk kez: Python + Inno Setup + Ollama + derleme + kurulum
test_build.bat   :: doğrulama + birim testleri + derleme + GERÇEK açılış testi
build_exe.bat    :: yalnızca derleme/paketleme (--no-models ile modeller atlanır)
SATIR_SONU_DUZELT.bat :: "'hcp' is not recognized" hatalarını onarır (.bat → CRLF)
```

`build.py` her şeyi yapar:

```bat
python build.py --check                 :: statik doğrulama + birim testleri (her platformda çalışır)
python build.py --fix-eol              :: .bat dosyalarını CRLF yapar (cmd.exe LF'de ilk karakteri yutar)
python build.py --all                   :: check → onefile → portable → setup → publish → smoke → zip
python build.py --onefile --portable    :: yalnızca tek EXE + taşınabilir zip
python build.py --smoke                 :: derlenmiş EXE'yi çalıştırıp --version ve --selftest
python build.py --publish               :: derlenen EXE'yi panelin dağıtım deposuna kopyalar
python build.py --rollback              :: son yedekten ayarları geri getirir
```

Çıktılar:

```
public\agent\dist\
├── JARVIS.exe                      (tek dosya)
├── JARVIS-Portable\                (EXE + portable.txt + JARVIS-Data + voices + models)
├── JARVIS-Portable-v3.5.4.zip
├── JARVIS-Windows-v3.5.4.zip       (Setup + tek EXE + taşınabilir)
└── JARVIS-Setup.exe
<proje>\agent-dist\                 (panelin ajanlara dağıttığı EXE + özet)
```

---

## 3. Ayarlar ve veritabanı nerede, nasıl korunur?

| Veri | Yer | Güncellemede | Kaldırmada |
|---|---|---|---|
| `config.json` (ajan anahtarı, MT5 yolu, LLM…) | **EXE'nin yanında** | **Ezilmez** | Sorulmadan silinmez |
| Ajan logları, KANAL kilitleri, yedekler | `%APPDATA%\JARVIS` | Korunur | **Korunur** (isteğe bağlı silme) |
| Panel veritabanı `jarvis.db.tgz` | `%APPDATA%\JARVIS` | Korunur (`.bak` + bozuk dosya ayrımı) | Korunur |
| Taşınabilir modda her şey | `<EXE>\JARVIS-Data\` | Korunur | Klasörü silince gider |

Katmanlar:

1. **Güncelleme paketi** `config.json` içermez (`/api/agent/bundle?mode=update`).
2. **Güncelleyici** yalnızca izinli dosyalara yazar: `*.py`, `mql5/*.mq5`,
   `requirements*.txt`, `config.example.json`, `README.md`.
   `config.json`, `portable.txt`, `logs/`, `backups/`, `voices/`, `models/`,
   `JARVIS-Data/` **asla** indirilmez.
3. **Setup.exe** kurulumda `config.json` için `onlyifdoesntexist` kullanır:
   var olan ayar dosyasına dokunmaz.
4. **Kaldırma** verileri silmez; isteğe bağlı silme sorusu sorar.
5. **Yedek**: her güncelleme öncesi `%APPDATA%\JARVIS\backups\<zaman>\`
   (config.json + KANAL kilitleri + panel veritabanı). Son 10 yedek tutulur.

Geri alma:

```bat
JARVIS.exe --rollback     :: en son yedek
JARVIS.exe --backups      :: yedekleri listele
```

---

## 4. Uygulama içi güncelleme (panel → ajan)

```
┌────────────┐  manifest (SHA-256 listesi)   ┌──────────────┐
│  JARVIS    │ ◄───────────────────────────── │ Next.js      │
│  .exe      │  /api/agent/manifest           │ panel        │
│            │  /api/agent/file?name=…        │              │
│            │  /api/agent/exe-manifest       │ agent-dist\  │
│            │  /api/agent/exe  ← yeni EXE    │ JARVIS.exe   │
└────────────┘                                └──────────────┘
```

**Açılışta** (varsayılan olarak panel yerel ağdaysa açık):

1. `/api/agent/manifest` → değişen `.py` / `.mq5` / `requirements` dosyaları indirilir,
   özeti doğrulanır, yedek alınıp **atomik** olarak değiştirilir.
2. `/api/agent/exe-manifest` → paneldeki EXE sürümü daha yüksekse indirilir;
   `JARVIS.exe` → `JARVIS.exe.old` (Windows'ta çalışan dosya yeniden adlandırılabilir),
   `JARVIS.exe.new` → `JARVIS.exe`, ardından yeni sürüm ayrı süreçte başlatılır.
3. Açık işlem varsa (`can_restart=False`) EXE diske yazılır ama yeniden başlatma ertelenir:
   *"açık işlem var, yeni sürüm yeniden başlatınca devreye girecek"*.

**Güvenlik:** her dosyanın SHA-256'sı paneldeki özetle karşılaştırılır; uyuşmazsa
**hiçbir dosyaya yazılmaz**. İndirilen EXE `MZ` imzası taşımıyorsa reddedilir.
Yeniden başlatma döngüsünü önlemek için en fazla 2 nesil (`JARVIS_UPDATE_GEN`).

Kapatmak için: `JARVIS.exe --no-update` veya `config.json` → `"auto_update": false`.

### Panele yeni EXE'yi yüklemek

```bat
cd public\agent
python build.py --onefile --publish
```

`agent-dist\JARVIS.exe` + `agent-dist\JARVIS.exe.json` (sürüm, boyut, sha256) oluşur.
Panel bunları **yalnızca geçerli ajan anahtarıyla** sunar; dosya `public/` altında
değildir, oturumsuz indirilemez. Bu klasörde EXE yoksa ajan `404` alır ve sessizce atlar.

---

## 5. Taşınabilir sürüm

`JARVIS-Portable\` içindeki **`portable.txt`** dosyası "taşınabilirim" işaretidir:

* Ayarlar `config.json` (yanında), veriler `JARVIS-Data\` (yanında) tutulur.
* `%APPDATA%` hiç kullanılmaz → bilgisayarda iz bırakmaz.
* Klasörü USB'ye kopyalayıp başka makinede çalıştırabilirsiniz.

Kurulum sürümünde `portable.txt` **yoktur**; veriler `%APPDATA%\JARVIS`'e yazılır.
Ortam değişkeni ile her şey geçersiz kılınabilir: `JARVIS_HOME=C:\yol`.

---

## 6. Komut satırı

| Komut | Açıklama |
|---|---|
| `JARVIS.exe` | Normal açılış (ilk kezse kurulum sihirbazı) |
| `JARVIS.exe --setup` | Kurulum sihirbazını yeniden aç |
| `JARVIS.exe --version` | Sürümü yaz ve çık |
| `JARVIS.exe --selftest` | Yol/yedek/modül/panel kontrolü, çıkış kodu 0/1 |
| `JARVIS.exe --paths` | Ayar ve veri yollarını yazdır |
| `JARVIS.exe --backups` | Yedekleri listele |
| `JARVIS.exe --rollback` | Son yedeğe dön |
| `JARVIS.exe --no-update` | Güncellemeyi atla |
| `JARVIS.exe --no-voice` | Ses kapalı |

Ortam değişkenleri: `JARVIS_HOME`, `JARVIS_PORTABLE=1`, `JARVIS_NO_UPDATE=1`.

---

## 7. Sürekli entegrasyon (GitHub Actions)

`public\agent\ci\build-agent.yml` Windows sunucusunda:

doğrulama + birim testleri → PyInstaller (tek EXE) → taşınabilir paket →
Inno Setup → **açılış testi** → artefakt yükleme.

`Actions ▸ Build JARVIS EXE ▸ Run workflow`. Çıktı: `JARVIS-Windows` artefaktı.
Repo **private** olsun (`config.json` ajan anahtarı içerir).

---

## 8. Sorun giderme

| Belirti | Çözüm |
|---|---|
| `JARVIS.exe` 5 saniye geç açılıyor | Tek dosya sürümü normal davranış; hız için `--onedir` |
| Güncelleme yapılmıyor | Panel URL yerel ağda mı? `JARVIS.exe --selftest` → "Panel bağlantısı" |
| *"panele ulaşılamadı"* | Panel (`PANEL_BASLAT.bat`) açık mı? Ajan yine de çalışır |
| *"ajan anahtarı reddedildi (401)"* | Panel ▸ Yerel Ajan ▸ anahtarı kopyala → `--setup` |
| *"panelde derlenmiş JARVIS.exe yok"* | `python build.py --onefile --publish` |
| Güncelleme sonrası sorun | `JARVIS.exe --rollback` |
| Setup.exe üretilmiyor | Inno Setup 6 kurulu mu? https://jrsoftware.org/isdl.php |
| Ses yok | `pip install -r requirements-voice.txt` (olmadan da çalışır, Windows sesine düşer) |
| **`'hcp'` / `'etlocal'` / `'cho.'` / `'all'` is not recognized** | `.bat` dosyası **LF (Unix)** satır sonlu — cmd.exe her satırın ilk karakterini yer. Çözüm: **`SATIR_SONU_DUZELT.bat`** veya `python build.py --fix-eol` |

---

## 9. Bu sürümde eklenenler (v3.5.4)

* **Electron masaüstü uygulaması (panel)**: `electron/` + `PANEL_MASAUSTU.bat`.
  Panel tarayıcı yerine bağımsız pencerede çalışır; yerel Next.js sunucusunu arka
  planda başlatır, pencere kapanınca sunucu da temiz kapanır. Installer üretimi:
  `npm run dist` → `electron\release\` (NSIS `.exe` / DMG / AppImage). Ayrıntı: `electron\README.md`.
* **Tek dosya EXE**: `jarvis_onefile.spec` (PyInstaller onefile).
* **Taşınabilir sürüm**: `portable.txt` + `JARVIS-Data` + zip.
* **Derleyici otomasyonu**: `build.py` (check / onefile / onedir / portable / setup / publish / smoke / zip / rollback).
* **Uygulama içi EXE güncellemesi**: `updater.py` — çalışan EXE'yi kendisiyle değiştirir.
* **Panel uçları**: `/api/agent/exe-manifest` ve `/api/agent/exe` (ajan anahtarıyla, `agent-dist/`).
* **Yol yönetimi**: `jarvis_paths.py` — ayarlar EXE'nin yanında, veriler ortak evde.
* **Yedek / geri alma**: güncelleme öncesi otomatik yedek, `--rollback`, son 10 yedek.
* **Açılış testi**: `--version`, `--selftest`, `--paths`, `--backups`; `test_build.bat` ve CI'da çalışır.
* **Kurulum paketi**: sürüm EXE'den okunur, `config.json` ezilmez, kaldırırken veriler korunur.
* **Eksik simgeler eklendi**: `public/agent/jarvis.ico` (16→256, 9 boyut) ve
  `public/agent/jarvis_icon.png`. Bunlar depoda **yoktu**; `jarvis.spec` (`icon=`),
  `installer.iss` (`SetupIconFile=`) ve paneldeki Yerel Ajan sayfası bunlara
  başvurduğu için derleme duruyordu / simge kırık görünüyordu.
  `build.py --check` artık bu iki dosyayı zorunlu olarak doğrular.
* **Testler**: `tests/` altında 25 birim testi (sahte panel sunucusuyla gerçek indirme,
  özet doğrulama, atomik değişim, yedek/geri alma, taşınabilir-yol çözümleme).

### Bilinen kısıtlar

* EXE **yalnızca Windows'ta** derlenebilir (PyInstaller çapraz derlemez; `MetaTrader5`
  yalnızca `win_amd64`). Bu depoda Linux/macOS'ta `python build.py --check` ve
  birim testleri çalışır, derleme Windows/CI'da yapılır.
* `npm run lint` projedeki mevcut React/ESLint uyarıları nedeniyle hâlâ başarısız;
  `npm run typecheck` ve `npm run build` temiz geçiyor.
* faster-whisper/piper modelleri `--no-models` ile atlanabilir; atlanırsa ilk
  kullanımda indirilir.
