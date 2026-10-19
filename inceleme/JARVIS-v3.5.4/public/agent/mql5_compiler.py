"""
mql5_compiler.py — JARVIS MQL5 geliştirici & otomatik derleyici
================================================================
* .mq5 kaynaklarını okur / yazar (her yazımda zaman damgalı yedek alır).
* `metaeditor64.exe /compile:"dosya.mq5" /log:"dosya.log"` ile arka planda derler (subprocess).
* Derleme logunu (UTF-16 LE) ayrıştırır: hata/uyarı satır-sütun bilgisi.
* Otonom hata ayıklama: hataları + ilgili kod parçalarını yerel LLM'e verir, düzeltilmiş kodu yazar,
  başarılı .ex5 elde edilene kadar (max_attempts) tekrar derler.
* Talimatla strateji güncelleme (Gann, SMC, RSI/CCI…) + otomatik derleme.

Linux/Mac'te Wine ile: MQL5Compiler(..., wine=True)
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Protocol

log = logging.getLogger("jarvis.mql5")

ERR_RE = re.compile(
    r"^(?P<file>.*?\.mq[5h])\((?P<line>\d+),(?P<col>\d+)\)\s*:\s*(?P<kind>error|warning)\s+(?P<code>\d+)\s*:\s*(?P<msg>.*)$",
    re.I,
)
# Bazı build'lerde format: "dosya.mq5 : error 123: mesaj" (satırsız)
ERR_RE2 = re.compile(r"^(?P<file>.*?\.mq[5h])\s*:\s*(?P<kind>error|warning)\s+(?P<code>\d+)\s*:\s*(?P<msg>.*)$", re.I)
RESULT_RE = re.compile(r"(\d+)\s+errors?,\s*(\d+)\s+warnings?", re.I)


class LLMLike(Protocol):
    def chat(self, messages: list[dict], timeout: int = 120) -> str: ...


@dataclass
class Diagnostic:
    kind: str
    code: int
    line: int
    col: int
    message: str
    file: str

    def __str__(self) -> str:
        return f"{Path(self.file).name}({self.line},{self.col}) : {self.kind} {self.code}: {self.message}"


@dataclass
class CompileResult:
    success: bool
    errors: list[Diagnostic] = field(default_factory=list)
    warnings: list[Diagnostic] = field(default_factory=list)
    log: str = ""
    ex5_path: Optional[str] = None
    elapsed: float = 0.0


@dataclass
class FixReport:
    success: bool
    attempts: int
    final: CompileResult
    code: str
    log: str


def extract_code(text: str) -> str:
    m = re.search(r"```(?:mql5|mq5|cpp|c\+\+|c)?\s*\n([\s\S]*?)```", text, re.I)
    return (m.group(1) if m else text).strip()


class MQL5Compiler:
    def __init__(
        self,
        metaeditor_path: str,
        mql5_dir: str,
        include_dir: Optional[str] = None,
        wine: bool = False,
        timeout: int = 180,
        backups: bool = True,
    ) -> None:
        self.metaeditor = metaeditor_path
        self.mql5_dir = Path(mql5_dir)
        self.include_dir = include_dir or str(self.mql5_dir)
        self.wine = wine
        self.timeout = timeout
        self.backups = backups

    # ------------------------------------------------------------------ dosya
    def resolve(self, rel_or_abs: str) -> Path:
        p = Path(rel_or_abs.replace("\\", os.sep))
        if p.is_absolute():
            return p
        parts = p.parts
        if parts and parts[0].upper() == "MQL5":
            p = Path(*parts[1:])
        return self.mql5_dir / p

    def list_sources(self, sub: str = "Experts") -> list[Path]:
        return sorted((self.mql5_dir / sub).rglob("*.mq5"))

    def read(self, path: str | Path) -> str:
        p = self.resolve(str(path))
        raw = p.read_bytes()
        for enc in ("utf-8-sig", "utf-16", "cp1254", "latin-1"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    def write(self, path: str | Path, code: str) -> Path:
        p = self.resolve(str(path))
        p.parent.mkdir(parents=True, exist_ok=True)
        if self.backups and p.exists():
            bdir = p.parent / ".jarvis_backup"
            bdir.mkdir(exist_ok=True)
            shutil.copy2(p, bdir / f"{p.stem}_{time.strftime('%Y%m%d_%H%M%S')}{p.suffix}")
        # MetaEditor UTF-8 BOM'lu dosyaları sorunsuz okur (Türkçe yorumlar için)
        p.write_text(code, encoding="utf-8-sig", newline="\r\n")
        return p

    # ------------------------------------------------------------------ derleme
    def compile(self, path: str | Path) -> CompileResult:
        src = self.resolve(str(path))
        if not src.exists():
            return CompileResult(False, log=f"Dosya bulunamadı: {src}")
        log_path = src.with_suffix(".log")
        if log_path.exists():
            log_path.unlink()
        cmd = [self.metaeditor, f"/compile:{src}", f"/log:{log_path}", f"/inc:{self.include_dir}"]
        if self.wine:
            cmd = ["wine"] + cmd
        t0 = time.time()
        log.info("Derleniyor: %s", src.name)
        try:
            # MetaEditor dönüş kodu güvenilir değildir (hata sayısını döndürebilir) -> logu esas al
            subprocess.run(cmd, timeout=self.timeout, capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except FileNotFoundError:
            return CompileResult(False, log=f"metaeditor bulunamadı: {self.metaeditor}")
        except subprocess.TimeoutExpired:
            return CompileResult(False, log=f"Derleme zaman aşımı ({self.timeout}s)")
        elapsed = time.time() - t0

        for _ in range(20):  # log dosyasının yazılmasını bekle
            if log_path.exists() and log_path.stat().st_size > 0:
                break
            time.sleep(0.25)
        text = self._read_log(log_path)
        errors, warnings = self.parse_log(text)
        ex5 = src.with_suffix(".ex5")
        m = RESULT_RE.search(text)
        n_err = int(m.group(1)) if m else len(errors)
        success = n_err == 0 and ex5.exists() and ex5.stat().st_mtime >= t0 - 2
        return CompileResult(success, errors, warnings, text.strip(), str(ex5) if success else None, elapsed)

    @staticmethod
    def _read_log(p: Path) -> str:
        if not p.exists():
            return "(log oluşmadı)"
        raw = p.read_bytes()
        if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
            return raw.decode("utf-16", errors="replace")
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return raw.decode("cp1254", errors="replace")

    @staticmethod
    def parse_log(text: str) -> tuple[list[Diagnostic], list[Diagnostic]]:
        errs: list[Diagnostic] = []
        warns: list[Diagnostic] = []
        for line in text.splitlines():
            line = line.strip()
            m = ERR_RE.match(line)
            if m:
                d = Diagnostic(m["kind"].lower(), int(m["code"]), int(m["line"]), int(m["col"]), m["msg"].strip(), m["file"])
            else:
                m = ERR_RE2.match(line)
                if not m:
                    continue
                d = Diagnostic(m["kind"].lower(), int(m["code"]), 0, 0, m["msg"].strip(), m["file"])
            (errs if d.kind == "error" else warns).append(d)
        return errs, warns

    # ------------------------------------------------------------------ otonom hata ayıklama
    @staticmethod
    def _context(code: str, diags: list[Diagnostic], radius: int = 4) -> str:
        lines = code.splitlines()
        chunks = []
        for d in diags[:12]:
            if d.line <= 0:
                continue
            a, b = max(0, d.line - 1 - radius), min(len(lines), d.line + radius)
            snippet = "\n".join(f"{i + 1:>4}{'>>' if i + 1 == d.line else '  '} {lines[i]}" for i in range(a, b))
            chunks.append(f"--- {d} ---\n{snippet}")
        return "\n\n".join(chunks)

    def auto_fix(
        self,
        path: str | Path,
        llm: Optional[LLMLike],
        max_attempts: int = 5,
        fix_warnings: bool = False,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> FixReport:
        say = on_progress or (lambda s: log.info(s))
        history: list[str] = []
        code = self.read(path)
        result = CompileResult(False)
        for attempt in range(1, max_attempts + 1):
            result = self.compile(path)
            head = f"[Deneme {attempt}] {len(result.errors)} hata, {len(result.warnings)} uyarı ({result.elapsed:.1f}s)"
            say(head)
            history.append(head)
            history.extend(str(d) for d in result.errors + result.warnings)
            needs = result.errors or (fix_warnings and result.warnings)
            if result.success and not needs:
                history.append(f"✓ {Path(result.ex5_path or '').name} oluşturuldu.")
                return FixReport(True, attempt, result, code, "\n".join(history))
            if not result.errors and not result.ex5_path and not needs:
                history.append(result.log[-800:])
                break
            if llm is None or attempt == max_attempts:
                break
            diags = result.errors + (result.warnings if fix_warnings else [])
            say(f"[Otonom düzeltme] {len(diags)} sorun LLM'e gönderiliyor…")
            history.append("[Otonom düzeltme] LLM çağrılıyor")
            prompt = (
                "Aşağıdaki MQL5 Expert Advisor MetaEditor ile derlenirken hata verdi.\n"
                "Hataları düzelt; strateji mantığını DEĞİŞTİRME. Sadece derlenebilir TAM kodu tek bir ```mql5 bloğunda döndür.\n\n"
                f"DERLEME LOGU:\n{chr(10).join(str(d) for d in diags)}\n\n"
                f"HATA BAĞLAMI:\n{self._context(code, diags)}\n\n"
                f"TAM KOD:\n```mql5\n{code}\n```"
            )
            try:
                out = llm.chat([
                    {"role": "system", "content": "Sen MetaTrader 5 / MQL5 derleyici hatalarını düzelten uzman bir geliştiricisin. MQL4 sözdizimi kullanma; CTrade, CopyBuffer, indicator handle'ları kullan."},
                    {"role": "user", "content": prompt},
                ], timeout=240)
            except Exception as e:  # noqa: BLE001
                history.append(f"[Otonom düzeltme] LLM hatası: {e}")
                break
            new_code = extract_code(out)
            if len(new_code) < 40 or new_code == code:
                history.append("[Otonom düzeltme] LLM anlamlı değişiklik üretmedi.")
                break
            code = new_code
            self.write(path, code)
            history.append("[Otonom düzeltme] Kod güncellendi, yeniden derleniyor.")
        return FixReport(result.success, attempt, result, code, "\n".join(history))

    # ------------------------------------------------------------------ talimatla düzenleme
    def modify(self, path: str | Path, instruction: str, llm: LLMLike, compile_after: bool = True,
               max_attempts: int = 5) -> FixReport:
        code = self.read(path)
        out = llm.chat([
            {"role": "system", "content": "Sen JARVIS'in MQL5 geliştirici modülüsün. Kodu talimata göre güncelle. MT5 build 4000+ uyumlu, derlenebilir TAM kodu tek ```mql5 bloğunda döndür. Açıklama yazma."},
            {"role": "user", "content": f"Talimat: {instruction}\n\n```mql5\n{code}\n```"},
        ], timeout=300)
        new_code = extract_code(out)
        if len(new_code) < 40:
            raise RuntimeError("LLM geçerli kod döndürmedi")
        self.write(path, new_code)
        if not compile_after:
            return FixReport(True, 0, CompileResult(True), new_code, "Kod güncellendi (derlenmedi).")
        return self.auto_fix(path, llm, max_attempts=max_attempts)


# --------------------------------------------------------------------------- #
if __name__ == "__main__":  # python mql5_compiler.py "C:\...\metaeditor64.exe" "C:\...\MQL5" Experts\X.mq5
    import sys

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if len(sys.argv) < 4:
        print("Kullanım: python mql5_compiler.py <metaeditor64.exe> <MQL5 klasörü> <dosya.mq5>")
        sys.exit(1)
    c = MQL5Compiler(sys.argv[1], sys.argv[2])
    r = c.compile(sys.argv[3])
    print("BAŞARILI" if r.success else "HATALI", r.ex5_path or "")
    for d in r.errors + r.warnings:
        print(" ", d)
