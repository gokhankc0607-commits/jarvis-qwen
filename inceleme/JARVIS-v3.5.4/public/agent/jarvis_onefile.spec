# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — JARVIS **TEK DOSYA** (onefile) derlemesi
#
#   pyinstaller --noconfirm --clean jarvis_onefile.spec   ->   dist/JARVIS.exe
#
# Not: onefile, her açılışta içeriği geçici klasöre açar (ilk açılış 2-5 sn sürer).
#      Hızlı açılış isteyenler klasör sürümünü kullanabilir: jarvis.spec
#      Ayarlar (config.json) ve veriler her iki sürümde de korunur.
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [
    ("jarvis.ico", "."),
    ("config.example.json", "."),
    ("version.txt", "."),
    ("README.md", "."),
]
binaries = []
hiddenimports = [
    # JARVIS kendi modülleri
    "app", "mt5_engine", "mql5_compiler", "local_ai", "kanal_strategy", "crypto_engine",
    "jarvis_paths", "updater",
    # üçüncü taraf
    "ccxt", "requests", "numpy", "pandas",
    "pyttsx3.drivers", "pyttsx3.drivers.sapi5", "win32com.client", "comtypes",
    "MetaTrader5",
    # arayüz (kurulum sihirbazı)
    "tkinter", "tkinter.ttk", "tkinter.filedialog", "tkinter.messagebox",
]


def grab(pkg):
    """Paketi (veri + dll + alt modüller) güvenle topla; kurulu değilse atla."""
    global datas, binaries, hiddenimports
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:  # noqa: BLE001
        print(f"[jarvis_onefile.spec] {pkg} atlandı: {e}")


for p in ["faster_whisper", "ctranslate2", "onnxruntime", "piper", "sounddevice",
          "_sounddevice_data", "tokenizers", "av"]:
    grab(p)

try:
    hiddenimports += collect_submodules("huggingface_hub")
except Exception:  # noqa: BLE001
    pass

a = Analysis(
    ["jarvis_launcher.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["matplotlib", "IPython", "jupyter", "notebook", "pytest", "torch",
              "tensorflow", "PyQt5", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)

# ---- TEK DOSYA: her şey EXE'nin içinde (COLLECT yok) -----------------------
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="JARVIS",
    icon="jarvis.ico",
    console=True,          # canlı log konsolu (gizlemek için False)
    upx=False,
    version="version_info.txt",
)
