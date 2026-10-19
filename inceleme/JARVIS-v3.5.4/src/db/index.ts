import path from "path";
import os from "os";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, unlinkSync } from "fs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PGlite as PGliteT } from "@electric-sql/pglite";
import { Pool } from "pg";
import { BOOTSTRAP_SQL, MIGRATION_SQL } from "./bootstrap-sql";

/**
 * Veritabanı seçimi (DATABASE_URL):
 *  - "postgres://..." / "postgresql://..."      -> harici PostgreSQL sunucusu
 *  - boş / "pglite" / "pglite:./data/jarvis.db.tgz" -> GÖMÜLÜ PostgreSQL (PGlite)
 *
 * Gömülü mod, Windows'ta güvenilirlik için PGlite'ı BELLEKTE çalıştırır ve tüm veritabanını
 * tek bir sıkıştırılmış dosyaya atomik olarak kaydeder (tmp -> rename). Böylece
 * klasör tabanlı depolamanın bozulma / "RuntimeError: Aborted()" sorunları yaşanmaz.
 * Bağlantı ilk sorguda açılır; `next build` sırasında veritabanına dokunulmaz.
 */
const url = (process.env.DATABASE_URL ?? "").trim();
const useServer = /^postgres(ql)?:\/\//i.test(url);

type DB = NodePgDatabase<Record<string, never>>;

const g = globalThis as typeof globalThis & {
  __jarvisDb?: DB;
  __jarvisPool?: Pool;
  __jarvisPglite?: PGliteT;
};

/** Ortak veri yeri: proje klasöründen BAĞIMSIZ (yeni klasöre kurulsa da aynı veriler + aynı ajan anahtarı). */
export function sharedDataFile() {
  const base = process.env.JARVIS_DATA_DIR
    || (process.platform === "win32" ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "JARVIS") : path.join(os.homedir(), ".jarvis"));
  return path.join(base, "jarvis.db.tgz");
}

/**
 * Ortak dosya henüz yoksa önceki kurulumların verisini bulur (bir kez, KOPYALAYARAK — eskiler silinmez):
 * bu klasörün data\ dizini + yan klasörler (örn. İndirilenler\local-ai-mt5-jarvis (5)\data\jarvis.db.tgz). En yenisi seçilir.
 */
function migrateLegacy(target: string) {
  if (existsSync(target)) return;
  const cands: string[] = [];
  const add = (f: string) => { try { if (existsSync(f) && statSync(f).size > 1000) cands.push(f); } catch {} };
  const cwd = process.cwd();
  add(path.join(cwd, "data", "jarvis.db.tgz"));
  try {
    const parent = path.dirname(cwd);
    for (const d of readdirSync(parent, { withFileTypes: true }).slice(0, 300))
      if (d.isDirectory() && path.join(parent, d.name) !== cwd) add(path.join(parent, d.name, "data", "jarvis.db.tgz"));
  } catch {}
  if (!cands.length) return;
  cands.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(cands[0], target);
  console.log(`[db] Önceki kurulumdaki veriler ortak konuma taşındı (kopya): ${cands[0]} -> ${target}`);
}

function snapshotPath() {
  const raw0 = url.replace(/^pglite:?/i, "").trim();
  // "pglite", "pglite:shared" ve eski varsayılan "./data/jarvis.db.tgz" -> ortak konum
  if (!raw0 || /^shared$/i.test(raw0) || /^(\.[\\/])?data[\\/]jarvis\.db\.tgz$/i.test(raw0)) {
    const f = sharedDataFile();
    try { migrateLegacy(f); } catch (e) { console.error("[db] eski veri taşınamadı:", e); }
    return f;
  }
  let raw = raw0;
  // Eski sürüm klasör yolu verdiyse (data/jarvis-db) dosya adına çevir
  if (!/\.(tgz|tar\.gz|tar)$/i.test(raw)) raw = raw.replace(/[\\/]+$/, "") + ".db.tgz";
  return path.resolve(process.cwd(), raw);
}

function createPglite(): DB {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const file = snapshotPath();
  const lock = file + ".lock";
  mkdirSync(path.dirname(file), { recursive: true });

  // --- Tek örnek kilidi: aynı veritabanını iki panel açarsa veri kaybını önle
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8")) || 0;
    let alive = false;
    try {
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {}
    if (alive) {
      console.warn(
        `[db] UYARI: kilit dosyası başka bir işlemi gösteriyor (PID ${pid}). Aynı anda iki panel açıksa birini kapatın.`
      );
    }
  }
  writeFileSync(lock, String(process.pid));

  // --- Anlık görüntüyü yükle (bozuksa kenara al ve temiz başla)
  let blob: Blob | undefined;
  if (existsSync(file)) {
    try {
      copyFileSync(file, file + ".bak"); // önceki oturumun yedeği
      blob = new Blob([readFileSync(file)]);
    } catch (e) {
      console.error("[db] anlık görüntü okunamadı:", e);
    }
  }
  let client: PGliteT;
  try {
    client = new PGlite(blob ? { loadDataDir: blob } : undefined);
  } catch (e) {
    console.error("[db] anlık görüntü açılamadı, temiz veritabanı ile başlanıyor:", e);
    client = new PGlite();
  }

  let ready: Promise<void> = (async () => {
    try {
      await client.waitReady;
    } catch (e) {
      if (!blob) throw e;
      const bad = file.replace(/\.tgz$/i, "") + `.bozuk-${Date.now()}.tgz`;
      try { renameSync(file, bad); } catch {}
      console.error(`[db] anlık görüntü bozuk -> ${bad}. Temiz veritabanı oluşturuluyor.`);
      client = new PGlite();
      g.__jarvisPglite = client;
      await client.waitReady;
    }
    await client.exec(BOOTSTRAP_SQL.join(";\n"));
    for (const q of MIGRATION_SQL) await client.exec(q);
    console.log(`[db] Gömülü veritabanı hazır: ${file}`);
  })();
  ready.catch((e) => console.error("[db] başlatma hatası:", e));

  // --- Değişiklikleri izle ve atomik olarak kaydet
  let dirty = false;
  let saving = false;
  const isWrite = (q: unknown) => typeof q === "string" && !/^\s*(select|show|with\s+[\s\S]*?\)\s*select)\b/i.test(q);

  const save = async () => {
    if (!dirty || saving) return;
    saving = true;
    dirty = false;
    try {
      const f = await client.dumpDataDir("gzip");
      const buf = Buffer.from(await f.arrayBuffer());
      const tmp = file + ".tmp";
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    } catch (e) {
      dirty = true;
      console.error("[db] kaydetme hatası:", e);
    } finally {
      saving = false;
    }
  };
  setInterval(save, 4000).unref();

  const shutdown = async () => {
    await save().catch(() => {});
    try { unlinkSync(lock); } catch {}
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.once(sig, () => {
      shutdown().finally(() => process.exit(0));
    });
  }
  process.once("beforeExit", () => void shutdown());

  // Sorgu fonksiyonlarını sar: önce hazır olmayı bekle, yazma sorgularında kirli işaretle
  const proxy = new Proxy({} as PGliteT, {
    get(_t, prop) {
      const target = g.__jarvisPglite ?? client;
      const v = Reflect.get(target, prop, target);
      if (typeof v !== "function") return v;
      if (prop === "query" || prop === "exec" || prop === "transaction") {
        return async (...args: unknown[]) => {
          await ready;
          const c = g.__jarvisPglite ?? client;
          if (prop === "transaction" || isWrite(args[0])) dirty = true;
          return (Reflect.get(c, prop, c) as (...a: unknown[]) => unknown).apply(c, args);
        };
      }
      return v.bind(target);
    },
  });
  g.__jarvisPglite = client;
  // ready'yi globalde tut (client değişebilir)
  ready = ready.then(() => { g.__jarvisPglite = client; });
  return drizzlePglite(proxy) as unknown as DB;
}

function createDb(): DB {
  if (useServer) {
    const fresh = !g.__jarvisPool;
    const pool = g.__jarvisPool ?? new Pool({ connectionString: url });
    g.__jarvisPool = pool;
    if (fresh) {
      // Sunucu PostgreSQL: yeni sütunları (drizzle-kit push yapılmamış olsa da) ekle — idempotent
      (async () => {
        for (const q of MIGRATION_SQL) await pool.query(q).catch((e) => console.error("[db] geçiş uyarısı:", String(e.message).slice(0, 120)));
      })();
    }
    return drizzle(pool);
  }
  return createPglite();
}

function getDb(): DB {
  if (!g.__jarvisDb) g.__jarvisDb = createDb();
  return g.__jarvisDb;
}

/** Tembel (lazy) veritabanı: ilk kullanımda bağlanır. */
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb();
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export const dbMode = useServer ? "postgres" : "pglite";
