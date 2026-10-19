"""Test destekleri: sahte panel sunucusu + geçici kurulum klasörü.

Her FakePanel örneği KENDI handler sınıfını oluşturur; böylece testler
birbirinin panel durumunu (dosyalar, EXE, sürüm) bozmaz.
"""
from __future__ import annotations

import hashlib
import http.server
import json
import socketserver
import threading
from pathlib import Path
from urllib.parse import unquote


class _BaseHandler(http.server.BaseHTTPRequestHandler):
    """Sahte JARVIS paneli: manifest / file / exe-manifest / exe uçları."""

    files: dict = {}            # name -> bytes
    agent_version: str = "3.5.4"
    exe: bytes | None = None
    exe_version: str = "0.0.0"
    exe_sha: str = ""
    corrupt_files: set = set()  # bu dosyalar bozuk gönderilir
    require_key: str = "jrv_test"

    def log_message(self, *a):  # sessiz
        pass

    def _send(self, code: int, body: bytes = b"", ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.require_key and self.headers.get("x-agent-key") != self.require_key:
            return self._send(401, b'{"error":"gecersiz anahtar"}')
        path = self.path.split("?")[0]
        qs = {}
        if "?" in self.path:
            for kv in self.path.split("?", 1)[1].split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    qs[unquote(k)] = unquote(v)

        if path == "/api/agent/manifest":
            files = [
                {"name": n, "size": len(b), "sha256": hashlib.sha256(b).hexdigest()}
                for n, b in self.files.items()
            ]
            return self._send(200, json.dumps({"version": self.agent_version, "files": files}).encode())

        if path == "/api/agent/file":
            name = qs.get("name", "")
            data = self.files.get(name)
            if data is None:
                return self._send(404, b"", "text/plain")
            if name in self.corrupt_files:
                data = data + b"#bozuk"
            return self._send(200, data, "application/octet-stream")

        if path == "/api/agent/exe-manifest":
            if not self.exe:
                return self._send(404, b"", "text/plain")
            return self._send(
                200,
                json.dumps(
                    {
                        "version": self.exe_version,
                        "sha256": self.exe_sha or hashlib.sha256(self.exe).hexdigest(),
                        "size": len(self.exe),
                        "builtAt": "2026-01-01T00:00:00Z",
                    }
                ).encode(),
            )

        if path == "/api/agent/exe":
            if not self.exe:
                return self._send(404, b"", "text/plain")
            return self._send(200, self.exe, "application/octet-stream")

        return self._send(404, b"", "text/plain")


class FakePanel:
    """Arka planda çalışan sahte panel (her örnek yalıtılmış durum)."""

    def __init__(self, **kw):
        self.handler = type("PanelHandler", (_BaseHandler,), dict(kw))
        self.httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), self.handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def set(self, **kw):
        """Panel durumunu sonradan değiştir (örn. files['config.json'] = b'...')."""
        for k, v in kw.items():
            setattr(self.handler, k, v)
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


def make_install(root: Path, *, version: str = "3.5.4", files: dict | None = None,
                 config: dict | None = None, portable: bool = False) -> Path:
    """Geçici bir JARVIS kurulumu (tek EXE + config.json + dosyalar) oluşturur."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "version.txt").write_text(version + "\n", encoding="utf-8")
    if portable:
        (root / "portable.txt").write_text("taşınabilir kurulum\n", encoding="utf-8")
    if config is not False:
        (root / "config.json").write_text(
            json.dumps(
                config if config is not None
                else {"dashboard_url": "", "agent_key": "jrv_test", "mt5": {"login": 12345}},
                ensure_ascii=False, indent=2,
            ),
            encoding="utf-8",
        )
    for name, data in (files or {}).items():
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data if isinstance(data, bytes) else data.encode())
    return root
