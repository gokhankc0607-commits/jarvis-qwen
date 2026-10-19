# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — JARVIS yerel ajan
# Derleme:  pyinstaller --noconfirm jarvis.spec   ->  dist\JARVIS\JARVIS.exe
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_dynamic_libs, collect_submodules

datas = [("jarvis.ico", "."), ("config.example.json", ".")]
binaries = []
hiddenimports = [
    "app", "mt5_engine", "mql5_compiler", "local_ai", "kanal_strategy", "crypto_engine", "ccxt",
    "pyttsx3.drivers", "pyttsx3.drivers.sapi5", "win32com.client", "comtypes",
    "MetaTrader5", "pandas", "numpy", "requests", "tkinter", "tkinter.ttk", "tkinter.filedialog",
]

def grab(pkg):
    """Paketi (veri + dll + alt modüller) güvenle topla; kurulu değilse atla."""
    global datas, binaries, hiddenimports
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception as e:  # noqa
        print(f"[jarvis.spec] {pkg} atlandı: {e}")

for p in ["faster_whisper", "ctranslate2", "onnxruntime", "piper", "sounddevice", "_sounddevice_data", "tokenizers", "av"]:
    grab(p)

try:
    hiddenimports += collect_submodules("huggingface_hub")
except Exception:
    pass

a = Analysis(
    ["jarvis_launcher.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["matplotlib", "IPython", "jupyter", "notebook", "pytest", "torch", "tensorflow", "PyQt5", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="JARVIS",
    icon="jarvis.ico",
    console=True,          # canlı log konsolu (gizlemek için False)
    upx=False,
    version="version_info.txt",
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="JARVIS")
