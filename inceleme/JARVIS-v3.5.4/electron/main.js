// JARVIS — Electron masaüstü uygulaması (ana süreç)
// v3.5.4: Next.js panelini yerel bir sunucuda çalıştırıp pencerede gösterir.
// - Veriler %100 makinede kalır (PGlite ./data, LanceDB ./.lancedb).
// - Pencere kapatıldığında uygulama tamamen kapanır (arka planda node kalmaz).
// - Sonraki açılışta son pencere boyutu/konumu korunur (electron-store).
// - v3.5.4 düzeltme: port çakışmasında otomatik boş port seçilir,
//   "Veri konumu" yanlışı düzeltildi (veriler gerçek panel kökünde),
//   sistem tepsisi + temiz kapanma (Windows'ta taskkill /T ile proces tree).
"use strict";

const { app, BrowserWindow, Menu, shell, dialog, Tray, nativeImage } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const Store = require("electron-store");

const store = new Store({ name: "jarvis-window" });

const PREF_PORT = parseInt(process.env.JARVIS_PORT || "3000", 10);
let PORT = PREF_PORT; // kullanımdaysa findFreePort() ile değiştirilir
const DEV_MODE = Boolean(process.env.JARVIS_DEV); // geliştirme: panel dışarıdan çalışıyor
let appUrl = process.env.JARVIS_DEV || `http://127.0.0.1:${PORT}`; // sunucu portu seçilince güncellenir
const PANEL_DIR = realPanelDir(); // next build çıktısı (.next) burada olmalı — veri evi de burası
const WIN = process.platform === "win32";

let mainWindow = null;
let serverProc = null;
let tray = null;

// ---------- Yardımcılar ----------
// asar içinde __dirname "...app.asar/electron" olur; dosya yolları ise
// "...app.asar.unpacked/electron" altında bulunur. Veri klasörlerinin
// arşivin DIŞINDA (gerçek diskte) kalması için bu dönüşüm yapılır.
function realPanelDir() {
  let d = path.join(__dirname, "..");
  if (d.includes(`${path.sep}app.asar${path.sep}`)) {
    d = d.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return d;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

// Tercih edilen port doluysa sıradaki boş portu bul (3000 doluysa 3001, 3002...)
async function findFreePort(preferred) {
  for (let p = preferred; p < preferred + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  return preferred;
}

// ---------- Tek örnek (single instance) ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- Yerel Next.js sunucusunu başlat / durdur ----------
function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(appUrl, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Sunucu ${timeoutMs / 1000} sn içinde hazır olmadı.`));
        } else {
          setTimeout(tryOnce, 500);
        }
      });
    };
    tryOnce();
  });
}

async function startServer() {
  if (serverProc) return;

  // Geliştirme modu: panel zaten dışarıdan çalışıyor (npm run dev), sunucu başlatma
  if (DEV_MODE) return;

  // Port çakışmasını önle: tercih edilen port doluysa sıradaki boş portu seç
  if (!(await isPortFree(PORT))) {
    const free = await findFreePort(PORT + 1);
    if (free !== PORT) {
      process.stdout.write(`[jarvis] Port ${PORT} kullanımda → ${free} üzerinde başlatılıyor.\n`);
      PORT = free;
      appUrl = `http://127.0.0.1:${PORT}`;
    }
  }

  const hasBuild = fs.existsSync(path.join(PANEL_DIR, ".next"));
  if (!hasBuild) {
    dialog.showErrorBox(
      "JARVIS başlatılamadı",
      "Panel derlemesi (.next klasörü) bulunamadı.\n\n" +
        "Önce terminalde şunu çalıştırın:\n  npm run build\n\n" +
        "veya geliştirme modu için:\n  npm run dev"
    );
    app.quit();
    return;
  }

  const nextBin = path.join(
    PANEL_DIR,
    "node_modules",
    ".bin",
    WIN ? "next.cmd" : "next"
  );
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PORT: String(PORT) };

  serverProc = spawn(nextBin, ["start", "-p", String(PORT)], {
    cwd: PANEL_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: WIN, // Windows'ta next.cmd için
    detached: !WIN, // POSIX: kendi süreç grubu → stopServer'da grupça öldürülür (torun sızıntısı olmaz)
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[panel] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[panel] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code !== 0 && code !== null) {
      dialog.showErrorBox(
        "Panel sunucusu durdu",
        `Next.js sunucusu beklenmedik şekilde kapandı (kod ${code}).\n` +
          "Ayrıntılar için terminalde 'npm run build && npm start' ile deneyin."
      );
    }
  });

  await waitForServer();
}

function stopServer() {
  if (!serverProc) return;
  const p = serverProc;
  serverProc = null;
  try {
    if (WIN) {
      // shell:true ile spawn edildiğinde child.kill tek başına next.exe'yi bırakabilir
      spawn("taskkill", ["/F", "/T", "/PID", String(p.pid)], { stdio: "ignore" });
    } else {
      // detached spawn → pgid === pid; tüm süreç grubunu (node torunları dahil) öldür
      process.kill(-p.pid, "SIGTERM");
    }
  } catch (_) {
    try {
      p.kill("SIGTERM"); // grup yoksa doğrudan çocuk
    } catch (__) {
      /* zaten kapanmış */
    }
  }
}

// ---------- Sistem tepsisi ----------
function createTray() {
  if (tray) return;
  // Küçük sembol: kodla üretilen geçerli 16x16 PNG (dosya bağımlılığı yok)
  const img = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWUlEQVR4nGNgGAWjYLgxGNaMYNgwYmBqBmQsB7KWAVnLsAzZkLEcyFouZCwHMpYDGcuBjOVAxnIgYzmQtRzIWg5kLA8aDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBoMGgwaDBp0AgBfyyEohI2MlQAAAABJRU5ErkJggg=="
  );
  // Data URL geçersizse boş image olur; sorun değil — tray yine de çalışır (Windows'ta gri kare)
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("JARVIS — MT5/Kripto Algoritmik İşlem Merkezi");
  const menu = Menu.buildFromTemplate([
    { label: "Pencereyi Göster", click: () => showWindow() },
    { type: "separator" },
    { label: "Kapan", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", () => showWindow());
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- Pencere ----------
function createWindow() {
  const bounds = store.get("bounds", {});
  mainWindow = new BrowserWindow({
    width: bounds.width || 1440,
    height: bounds.height || 900,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 700,
    title: "JARVIS — MT5/Kripto Algoritmik İşlem Merkezi",
    backgroundColor: "#0b0f17",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(appUrl);

  // Harici bağlantıları sistem tarayıcısında aç
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      store.set("bounds", mainWindow.getBounds());
    }
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);
  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()) {
      store.set("maximized", true);
    } else {
      store.delete("maximized");
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (store.get("maximized", false)) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on("closed", () => (mainWindow = null));
}

// ---------- Menü ----------
function buildMenu() {
  const template = [
    {
      label: "JARVIS",
      submenu: [
        {
          label: "Yeniden Başlat (Panel)",
          click: () => mainWindow && mainWindow.reload(),
        },
        { type: "separator" },
        { role: "quit", label: "Kapan" },
      ],
    },
    { role: "editMenu", label: "Düzen" },
    {
      label: "Görünüm",
      submenu: [
        { role: "reload", label: "Yenile" },
        { role: "forceReload", label: "Zorla Yenile" },
        { role: "toggleDevTools", label: "Geliştirici Araçları" },
        { type: "separator" },
        { role: "resetZoom", label: "Sıfırla Yakınlaştırma" },
        { role: "zoomIn", label: "Yakınlaştır +" },
        { role: "zoomOut", label: "Uzaklaştır −" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tam Ekran" },
      ],
    },
    {
      label: "Pencere",
      submenu: [{ role: "minimize", label: "Simge Durumu" }, { role: "zoom" }],
    },
    {
      label: "Yardım",
      submenu: [
        {
          label: "Veri konumu",
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "JARVIS Verileri",
              message: "Tüm veriler bu makinede saklanır:",
              detail:
                `Panel & DB : ${PANEL_DIR}\n` +
                `PGlite    : ${path.join(PANEL_DIR, "data")}\n` +
                `LanceDB   : ${path.join(PANEL_DIR, ".lancedb")}`,
            }),
        },
        {
          label: "Hakkında",
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "JARVIS Hakkında",
              message: "JARVIS — MT5/Kripto Algoritmik İşlem Merkezi",
              detail:
                `Sürüm: ${app.getVersion()}\n` +
                `Panel adresi: ${appUrl}\n` +
                `Electron: ${process.versions.electron} · Node: ${process.versions.node}\n` +
                `Ajan veri evi: ${WIN ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")) + path.sep + "JARVIS" : path.join(os.homedir(), ".jarvis")} (jarvis_paths.py)`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Yaşam döngüsü ----------
app.whenReady().then(async () => {
  buildMenu();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox("JARVIS başlatılamadı", String(e.message || e));
    app.quit();
    return;
  }
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Pencere kapatılınca uygulama tamamen kapansın → sunucu da ölür (gömülü DB kilidi için önemli)
app.on("window-all-closed", () => {
  app.quit();
});

// Kapanışta electron-store yazımlarının tamamlanması için küçük gecikme
app.on("before-quit", (e) => {
  stopServer();
  // v8'de senkron flush: store.set('bounds', ...) — bekleyen yazım varsa 250ms bekle
  if (!store.set || store.isFlushScheduled !== true) return;
  if (e.preventDefault) e.preventDefault();
  setTimeout(() => {
    app.exit(0);
  }, 250);
});
app.on("quit", stopServer);
