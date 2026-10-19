import { headers } from "next/headers";
import { getUser } from "@/lib/auth";
import AgentKey from "@/components/AgentKey";

const FILES = [
  ["CALISTIR.bat", "Ajanı kaynak koddan çalıştırır ve kendini panelden OTOMATİK günceller (EXE'yi yeniden derlemek gerekmez)"],
  ["KUR.bat", "TEK TIKLA KURULUM: Python + Inno Setup + Ollama kurar, EXE derler, Setup'ı açar"],
  ["kanal_strategy.py", "KANAL stratejisi: KANAL3BAND geri dönüş + RSI + CCI MA — Piyasa Gözlemi taraması"],
  ["mql5/KANAL_Strateji.mq5", "MT5 EA: Piyasa Gözlemi'ndeki tüm pariteleri tarar, varsayılan sadece uyarı (otomatik emir kapalı)"],
  ["mql5/KANAL3BAND.mq5", "Gösterge: Centered YSR merkez + 3 ATR bant çifti + 3 MA"],
  ["mql5/KANAL-CCI.mq5", "Gösterge: CCI(34) + MA(21) mor çizgi, trend rengi, alarm"],
  ["mql5/KANAL-RSI-PANEL.mq5", "Gösterge: RSI + M1…D1 çoklu zaman dilimi RSI paneli"],
  ["mt5_engine.py", "MT5 bağlantısı, fiyatlar, RSI/CCI/Stoch/uyumsuzluk analizi, onaylı emir gönderimi"],
  ["mql5_compiler.py", ".mq5 okuma/yazma, metaeditor64.exe /compile, log ayrıştırma, otonom LLM düzeltme döngüsü"],
  ["local_ai.py", "Yerel LLM istemcisi (Ollama/LM Studio/OmniRoute + opsiyonel bulut), faster-whisper STT, Piper/pyttsx3 TTS"],
  ["app.py", "Ana çalıştırıcı: panel senkronizasyonu, sesli onay döngüsü, derleme işçisi"],
  ["jarvis_launcher.py", "EXE giriş noktası: kurulum sihirbazı, MT5 yolu otomatik bulma, bağlantı testi"],
  ["build_exe.bat", "Tek tıkla JARVIS.exe + Setup.exe derleyici (PyInstaller + Inno Setup)"],
  ["jarvis.spec", "PyInstaller yapılandırması (whisper, piper, onnxruntime, MT5 dahil)"],
  ["installer.iss", "Inno Setup kurulum betiği (kısayollar, otomatik başlatma)"],
  ["ci/build-agent.yml", "GitHub Actions: Windows sunucusunda EXE'yi otomatik derler"],
  ["find_python.bat", "Uygun 64-bit Python 3.11'i bulur, yoksa kurar (MetaTrader5 uyumluluğu)"],
  ["requirements.txt", "Çekirdek Python bağımlılıkları"],
  ["requirements-voice.txt", "Ses paketleri (faster-whisper, piper) — opsiyonel"],
  ["config.example.json", "Örnek yapılandırma"],
];

export default async function AgentPage() {
  const u = await getUser();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}`;

  return (
    <div className="max-w-5xl">
      <h1 className="neon-text text-xl font-black tracking-[0.2em] text-cyan-200 md:text-2xl" style={{ fontFamily: "Orbitron" }}>YEREL AJAN</h1>
      <p className="mt-1 text-sm text-slate-400">Python ajanı Windows bilgisayarınızda MT5 ve MetaEditor'ın yanında çalışır; bu komuta merkezine güvenli anahtarla bağlanır.</p>

      <section className="glass hud-corner mt-6 rounded-2xl border-emerald-400/30 p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-300" style={{ fontFamily: "Orbitron" }}>Nasıl kurarım? · 4 adım</h3>
        <p className="mt-1 text-sm text-slate-400">
          Hazır bir Setup.exe indirilmez — Windows programları yalnızca Windows&apos;ta üretilebildiği için <b>KUR.bat</b> bunu sizin bilgisayarınızda otomatik yapar.
        </p>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["1", "İndir", <>Aşağıdaki <b className="text-cyan-200">⬇ JARVIS-Agent.zip</b> butonuna basın.</>],
            ["2", "Çıkart", <>Zip&apos;e sağ tık → <b>Tümünü ayıkla…</b> → örn. <code className="text-cyan-200">C:\JARVIS-Agent</code>. Zip&apos;in içinden çalıştırmayın.</>],
            ["3", "KUR.bat", <>Klasördeki <b className="text-cyan-200">KUR.bat</b>&apos;a çift tıklayın. Python, Inno Setup, Ollama kurulur ve EXE derlenir (10-20 dk).</>],
            ["4", "Kur & Aç", <><b>JARVIS-Setup.exe</b> kendiliğinden açılır → İleri → Kur. Sonra masaüstündeki <b>JARVIS</b> simgesi.</>],
          ].map(([n, t, d]) => (
            <li key={n as string} className="rounded-xl border border-cyan-400/15 bg-black/30 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-400/10 text-sm font-bold text-emerald-200" style={{ fontFamily: "Orbitron" }}>{n}</span>
                <span className="font-bold text-slate-100">{t}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
            <b className="text-amber-200">“MetaTrader5 … from versions: none” hatası:</b> Python sürümünüz uyumsuz. Güncel paketi indirip tekrar çalıştırın — betik otomatik olarak 64-bit Python 3.11 kurar ve eski <code>.venv</code>&apos;yi siler.<br /><br />
            <b className="text-amber-200">“Windows bilgisayarınızı korudu” uyarısı:</b> <i>Ek bilgi</i> → <i>Yine de çalıştır</i>. (Kendi derlediğiniz imzasız programlarda normaldir.)
          </div>
          <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
            <b className="text-cyan-200">İlk açılışta:</b> kurulum sihirbazı MT5 yollarını bulur → <i>Bağlantıları Test Et</i> → <i>Kaydet ve Başlat</i>. MT5&apos;te <b>Algo Trading</b> butonu açık olmalı.
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="glass hud-corner rounded-2xl p-5">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: "Orbitron" }}>Bağlantı Bilgileri</h3>
          <div className="space-y-3 text-sm">
            <div><div className="text-[11px] uppercase tracking-wider text-slate-500">Panel URL</div><code className="text-cyan-200">{url}</code></div>
            <AgentKey initial={u?.agentKey ?? ""} />
          </div>
        </section>
        <section className="glass hud-corner rounded-2xl p-5">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: "Orbitron" }}>Mimari</h3>
          <pre className="whitespace-pre text-[11px] leading-relaxed text-slate-300" style={{ fontFamily: "JetBrains Mono" }}>{`┌───────────── Windows PC ─────────────┐
│ MT5 Terminal ◄─ mt5_engine.py        │
│ metaeditor64 ◄─ mql5_compiler.py     │
│ Ollama/LMStudio ◄─ local_ai.py       │
│ Mikrofon/Hoparlör ◄─ whisper / piper │
│            ▲                          │
│          app.py  ──HTTPS + key──┐     │
└─────────────────────────────────┼─────┘
                                  ▼
                    JARVIS Komuta Merkezi`}</pre>
        </section>
      </div>

      <section className="glass hud-corner mt-4 rounded-2xl border-violet-400/30 p-5">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-violet-300" style={{ fontFamily: "Orbitron" }}>Güncelleme · baştan kurmaya gerek yok</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm text-slate-300">
          <div className="rounded-xl border border-cyan-400/15 bg-black/30 p-4">
            <div className="mb-1 font-bold text-cyan-200">1 · Panel</div>
            Yeni dosyaları eski klasörün <b>üzerine</b> ya da yeni bir klasöre çıkartın. Verileriniz proje klasöründe değil <code>%APPDATA%\JARVIS</code> içinde durur — <b>yeni klasörde de</b> aynı veriler ve aynı ajan anahtarı kullanılır.
            Sonra <b>PANEL_BASLAT.bat</b> — sürüm değiştiyse kendisi yeniden derler.
          </div>
          <div className="rounded-xl border border-emerald-400/20 bg-black/30 p-4">
            <div className="mb-1 font-bold text-emerald-200">2 · Ajan (önerilen)</div>
            <b>CALISTIR.bat</b> ile açın: ajan her başlangıçta panelden yeni dosyaları kendisi indirir, ayarlarınıza (<code>config.json</code>) dokunmaz. Bir kez geçiş için aşağıdaki güncelleme paketini kullanın.
            <a href="/api/agent/bundle?mode=update" className="mt-2 block rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-1.5 text-center font-bold text-emerald-100 hover:bg-emerald-400/20">⬇ Güncelleme paketi (config.json içermez)</a>
          </div>
          <div className="rounded-xl border border-amber-400/20 bg-black/30 p-4">
            <div className="mb-1 font-bold text-amber-200">3 · EXE kullanıyorsanız (v3.5.4: artık kendini günceller)</div>
            Ajan açılışta panelde derlenmiş yeni bir <code>JARVIS.exe</code> varsa <b>kendini indirip değiştirir</b>
            (özet doğrulanır, eski sürüm <code>.old</code> olarak saklanır, ayarlar korunur).
            Panelde EXE yoksa eski yöntem: güncelleme paketini üstüne çıkartıp <b>build_exe.bat --no-models</b> (2-3 dk).
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Tam zip&apos;i (JARVIS-Agent.zip) üzerine çıkartacaksanız <b>config.json</b>&apos;ı değiştirmeyin (MT5/MQL5 yollarınız orada). Otomatik güncelleme yalnızca yerel panel adreslerinde (localhost / 192.168.x.x) açıktır. Güncelleme bozulursa <code>JARVIS.exe --rollback</code> son yedeğe döner.</p>
      </section>

      <section className="glass hud-corner scanline relative mt-4 overflow-hidden rounded-2xl border-cyan-400/40 p-5 shadow-[0_0_40px_-12px_rgba(34,211,238,0.6)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/agent/jarvis_icon.png" alt="" className="h-16 w-16 rounded-2xl border border-cyan-400/40" />
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: "Orbitron" }}>Windows EXE Paketi</h3>
              <p className="mt-1 max-w-xl text-sm text-slate-300">
                Tüm modüller + <b>panel adresiniz ve ajan anahtarınız gömülü</b> config.json + EXE derleme araçları. Zip&apos;i açın, <code className="text-cyan-200">build_exe.bat</code>&apos;a çift tıklayın →{" "}
                <code className="text-cyan-200">JARVIS.exe</code> ve <code className="text-cyan-200">JARVIS-Setup.exe</code>.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/api/agent/bundle" className="rounded-xl border border-cyan-400/60 bg-cyan-500/20 px-5 py-2.5 font-bold tracking-wider text-cyan-50 transition hover:bg-cyan-400/30 hover:shadow-[0_0_30px_-6px_rgba(34,211,238,0.9)]" style={{ fontFamily: "Orbitron" }}>
              ⬇ JARVIS-Agent.zip
            </a>
            <a href="/api/agent/config" className="rounded-xl border border-slate-500/40 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200">config.json</a>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-cyan-400/15 bg-black/30 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-300">Yöntem A · Kendi PC&apos;nizde (önerilen)</div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>Python 3.11 kurun — “Add python.exe to PATH” işaretli</li>
              <li>(Opsiyonel) Setup.exe için <a className="text-cyan-300 underline" href="https://jrsoftware.org/isdl.php" target="_blank" rel="noreferrer">Inno Setup 6</a></li>
              <li>Zip&apos;i açın → <code className="text-cyan-200">test_build.bat</code> çift tık (doğrular, derler, <b>çalıştırıp test eder</b>)</li>
              <li><code className="text-cyan-200">dist\JARVIS-Portable\JARVIS.exe</code> — <b>tek dosya</b>; ayrıca taşınabilir zip ve <code>dist\JARVIS-Setup.exe</code></li>
            </ol>
          </div>
          <div className="rounded-xl border border-cyan-400/15 bg-black/30 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-violet-300">Yöntem B · GitHub Actions (kurulumsuz)</div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>Zip içeriğini <b>private</b> bir GitHub reposuna push edin</li>
              <li>Actions → “Build JARVIS EXE” → Run workflow</li>
              <li>~10 dk sonra “JARVIS-Windows” artefaktını indirin</li>
              <li>İçinde <code className="text-cyan-200">JARVIS-Setup.exe</code> ve taşınabilir klasör</li>
            </ol>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          İlk açılışta kurulum sihirbazı MT5 / MetaEditor / MQL5 klasörünü otomatik bulur, panel ve Ollama bağlantısını test eder. Yeniden açmak için <code>JARVIS.exe --setup</code>. Diğer komutlar: <code>--version · --selftest · --paths · --backups · --rollback · --no-update</code>. Anahtarınızı paylaşmayın; sızarsa yukarıdan “Yenile”.
          <br />
          <b>Yeni EXE&apos;yi bu panelden dağıtmak için:</b> ajan klasöründe <code>python build.py --onefile --publish</code> → dosya <code>agent-dist\JARVIS.exe</code> olarak buraya yazılır ve ajanlar yalnızca geçerli ajan anahtarıyla indirebilir.
        </p>
      </section>

      <section className="glass hud-corner mt-4 rounded-2xl p-5">
        <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: "Orbitron" }}>Python Modülleri</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {FILES.map(([f, d]) => (
            <a key={f} href={`/agent/${f}`} download className="glass-hover flex items-start gap-3 rounded-xl border border-cyan-400/15 bg-black/20 p-3 transition">
              <span className="text-cyan-300">⬇</span>
              <span><span className="block font-bold text-slate-100" style={{ fontFamily: "JetBrains Mono" }}>{f}</span><span className="text-xs text-slate-400">{d}</span></span>
            </a>
          ))}
        </div>
      </section>

      <section className="glass hud-corner mt-4 rounded-2xl p-5">
        <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-300" style={{ fontFamily: "Orbitron" }}>Kurulum</h3>
        <pre className="scroll-thin overflow-x-auto rounded-xl bg-black/40 p-4 text-[12px] leading-relaxed text-cyan-50" style={{ fontFamily: "JetBrains Mono" }}>{`# 1) Python 3.10+ (Windows, MT5 ile aynı makine)
mkdir C:\\jarvis && cd C:\\jarvis
# yukarıdaki dosyaları bu klasöre indirin
python -m venv .venv && .venv\\Scripts\\activate
pip install -r requirements.txt

# 2) Yerel LLM
ollama pull qwen2.5-coder:14b

# 3) Piper TTS Türkçe ses (opsiyonel, yoksa pyttsx3 kullanılır)
#    https://huggingface.co/rhasspy/piper-voices -> tr/tr_TR/dfki/medium
#    tr_TR-dfki-medium.onnx + .onnx.json dosyalarını .\\voices klasörüne koyun

# 4) Yapılandırma
copy config.example.json config.json
#   dashboard_url = ${url}
#   agent_key     = (yukarıdaki anahtar)
#   metaeditor_path, mql5_dir, mt5 login bilgileri

# 5) Başlat (kaynak koddan)  — veya build_exe.bat ile JARVIS.exe üretin
python jarvis_launcher.py  # kurulum sihirbazı + ajan
python app.py              # tam mod: MT5 + derleyici + ses
python app.py --no-voice   # sessiz mod
python app.py --test-compile Experts\\Jarvis\\Jarvis_RSI_CCI.mq5`}</pre>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-400">
          <li>Ajan her 2 sn'de bir hesap, pozisyon ve yeni sinyalleri gönderir; onaylanan sinyalleri ve derleme işlerini alır.</li>
          <li>Ajan sinyal bulduğunda “X paritesinde BUY fırsatı oluştu, işleme gireyim mi?” diye <b>sesli</b> sorar; faster-whisper ile cevabınızı dinler. Yalnızca “Evet” emir gönderir.</li>
          <li>Panelde “Evet” dediğinizde de sinyal <code>approved</code> olur ve ajan emri MT5'e gönderir.</li>
          <li>Derleme hatalarında ajan logu okur, LLM ile düzeltir ve en fazla 5 denemeye kadar tekrar derler.</li>
        </ul>
      </section>
    </div>
  );
}
