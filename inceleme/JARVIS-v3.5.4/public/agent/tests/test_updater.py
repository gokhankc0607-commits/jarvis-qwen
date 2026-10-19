"""updater testleri — sahte panele karşı gerçek indirme / yedekleme / EXE değişimi."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import jarvis_paths as P  # noqa: E402
import updater  # noqa: E402
from support import FakePanel, make_install  # noqa: E402

MZ = b"MZ" + b"\x00" * 512          # sahte ama "Windows çalıştırılabilir" imzalı gövde


class UpdaterTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="jarvis-upd-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.logs: list[str] = []
        self.env = dict(os.environ)
        os.environ.pop("JARVIS_UPDATE_GEN", None)
        os.environ["JARVIS_HOME"] = str(self.tmp / "home")
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        os.environ.clear()
        os.environ.update(self.env)

    def log(self, msg=""):
        self.logs.append(str(msg))

    def cfg(self, panel: FakePanel, **kw):
        c = {"dashboard_url": panel.url, "agent_key": "jrv_test", "auto_update": True}
        c.update(kw)
        return c


class TestVersion(UpdaterTestCase):
    def test_parse_and_compare(self):
        self.assertEqual(updater.parse_version("3.5.4"), (3, 5, 4))
        self.assertEqual(updater.parse_version("3.5"), (3, 5, 0))
        self.assertEqual(updater.parse_version("bozuk"), (0, 0, 0))
        self.assertEqual(updater.cmp_version("3.5.4", "3.5.3"), 1)
        self.assertEqual(updater.cmp_version("3.5.3", "3.5.4"), -1)
        self.assertEqual(updater.cmp_version("3.5.4", "3.5.4"), 0)
        self.assertEqual(updater.cmp_version("3.10.0", "3.9.9"), 1)

    def test_current_version_from_file_then_app(self):
        root = self.tmp / "app"
        make_install(root, version="9.9.9")
        self.assertEqual(updater.current_version(root), "9.9.9")
        (root / "version.txt").unlink()
        (root / "app.py").write_text('AGENT_VERSION = "1.2.3"\n', encoding="utf-8")
        self.assertEqual(updater.current_version(root), "1.2.3")

    def test_auto_update_default_by_host(self):
        self.assertTrue(updater.auto_update_enabled({"dashboard_url": "http://localhost:3000"}))
        self.assertTrue(updater.auto_update_enabled({"dashboard_url": "http://192.168.1.9:3000"}))
        self.assertFalse(updater.auto_update_enabled({"dashboard_url": "https://jarvis.ornek.com"}))
        self.assertFalse(updater.auto_update_enabled({"dashboard_url": "http://localhost:3000", "auto_update": False}))


class TestFileUpdate(UpdaterTestCase):
    def test_no_change_when_hashes_match(self):
        root = make_install(self.tmp / "app", files={"app.py": "print('ayni')\n"})
        panel = FakePanel(files={"app.py": b"print('ayni')\n"}, agent_version="3.5.4")
        self.addCleanup(panel.stop)
        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")
        self.assertEqual(r.files, [])
        self.assertFalse(r.exe)
        self.assertFalse(bool(r))

    def test_files_updated_and_config_preserved(self):
        root = make_install(
            self.tmp / "app",
            files={"app.py": "eski\n", "mql5/KANAL_Strateji.mq5": "//eski\n"},
            config={"mt5": {"login": 4242}, "agent_key": "jrv_test"},
        )
        cfg_before = json.loads((root / "config.json").read_text(encoding="utf-8"))
        panel = FakePanel(
            files={"app.py": b"yeni\n", "mql5/KANAL_Strateji.mq5": b"//yeni\n"},
            agent_version="3.5.4",
        )
        self.addCleanup(panel.stop)

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")

        self.assertEqual(sorted(r.files), ["app.py", "mql5/KANAL_Strateji.mq5"])
        self.assertEqual((root / "app.py").read_text(encoding="utf-8"), "yeni\n")
        self.assertEqual((root / "mql5" / "KANAL_Strateji.mq5").read_text(encoding="utf-8"), "//yeni\n")
        # ayarlar AYNEN korunur
        self.assertEqual(json.loads((root / "config.json").read_text(encoding="utf-8")), cfg_before)
        # yedek alındı ve içinde config.json var
        backups = updater.list_backups(self.tmp / "home")
        self.assertTrue(backups)
        self.assertTrue((backups[0] / "config.json").exists())
        self.assertTrue((backups[0] / "manifest.json").exists())

    def test_hash_mismatch_writes_nothing(self):
        root = make_install(self.tmp / "app", files={"app.py": "eski\n"})
        panel = FakePanel(files={"app.py": b"yeni\n"}, agent_version="3.5.4", corrupt_files={"app.py"})
        self.addCleanup(panel.stop)

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")

        self.assertEqual(r.files, [])
        self.assertEqual((root / "app.py").read_text(encoding="utf-8"), "eski\n")
        self.assertIn("sağlama toplamı uyuşmadı", "\n".join(self.logs))

    def test_unsafe_names_are_ignored(self):
        """config.json / .bat / .exe manifestte gelse bile indirilmez."""
        root = make_install(self.tmp / "app", files={"app.py": "eski\n"})
        panel = FakePanel(files={"app.py": b"yeni\n"}, agent_version="3.5.4")
        self.addCleanup(panel.stop)
        files = dict(panel.handler.files)
        files.update({"config.json": b'{"agent_key":"EZILDI"}', "CALISTIR.bat": b"echo x",
                      "../config.json": b"kotu"})
        panel.set(files=files)

        updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")

        self.assertIn("mt5", json.loads((root / "config.json").read_text(encoding="utf-8")))
        self.assertNotEqual((root / "config.json").read_text(encoding="utf-8"), '{"agent_key":"EZILDI"}')
        self.assertFalse((root / "CALISTIR.bat").exists())
        self.assertFalse((self.tmp / "config.json").exists())

    def test_bad_key_skips(self):
        root = make_install(self.tmp / "app", files={"app.py": "eski\n"})
        panel = FakePanel(files={"app.py": b"yeni\n"}, agent_version="3.5.4")
        self.addCleanup(panel.stop)
        r = updater.startup_update(self.cfg(panel, agent_key="yanlis"), self.log,
                                   root=root, home=self.tmp / "home")
        self.assertIn("401", r.skipped)
        self.assertEqual((root / "app.py").read_text(encoding="utf-8"), "eski\n")


class TestExeUpdate(UpdaterTestCase):
    def _frozen(self, root: Path):
        """JARVIS.exe varmış gibi davranmak için yamalar."""
        self._orig_frozen = P.is_frozen
        P.is_frozen = staticmethod(lambda: True)
        updater.P.is_frozen = P.is_frozen
        target = root / "JARVIS.exe"
        self._orig_exe_target = updater.exe_target
        updater.exe_target = staticmethod(lambda r=None: target)
        self.addCleanup(self._unfrozen)
        return target

    def _unfrozen(self):
        P.is_frozen = self._orig_frozen
        updater.P.is_frozen = self._orig_frozen
        updater.exe_target = self._orig_exe_target

    def test_exe_downloaded_swapped_and_relaunched(self):
        root = make_install(self.tmp / "app", version="3.5.3", files={"app.py": "x\n"})
        target = self._frozen(root)
        target.write_bytes(MZ + b"ESKI SURUM")
        new_exe = MZ + b"YENI SURUM 3.5.4"

        launched: list[list[str]] = []
        updater.relaunch = lambda t, args, cwd: launched.append([str(t), *args])

        import hashlib
        panel = FakePanel(files={"app.py": b"x\n"}, agent_version="3.5.4", exe=new_exe,
                          exe_version="3.5.4", exe_sha=hashlib.sha256(new_exe).hexdigest())
        self.addCleanup(panel.stop)

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home",
                                   args=["--no-voice"])

        self.assertTrue(r.exe, self.logs)
        self.assertEqual(r.exe_version, "3.5.4")
        self.assertTrue(r.restarted)
        self.assertEqual(launched[0][0], str(target))
        self.assertIn("--no-voice", launched[0])
        # diskte yeni sürüm, artık yok
        self.assertEqual(target.read_bytes(), new_exe)
        self.assertFalse(target.with_name("JARVIS.exe.new").exists())
        self.assertFalse(target.with_name("JARVIS.exe.old").exists())
        self.assertTrue(any("güncellendi" in m for m in self.logs))

    def test_exe_not_replaced_when_version_not_newer(self):
        root = make_install(self.tmp / "app", version="3.5.4", files={"app.py": "x\n"})
        target = self._frozen(root)
        target.write_bytes(MZ + b"MEVCUT")
        updater.relaunch = lambda *a, **k: self.fail("yeniden başlatılmamalı")
        panel = FakePanel(files={"app.py": b"x\n"}, agent_version="3.5.4",
                          exe=MZ + b"AYNI", exe_version="3.5.4")
        self.addCleanup(panel.stop)

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")
        self.assertFalse(r.exe)
        self.assertEqual(target.read_bytes(), MZ + b"MEVCUT")

    def test_restart_blocked_by_open_positions(self):
        """Açık işlem varken dosya değişimi yapılır ama yeniden başlatılmaz."""
        root = make_install(self.tmp / "app", version="3.5.3", files={"app.py": "x\n"})
        target = self._frozen(root)
        target.write_bytes(MZ + b"ESKI")
        new_exe = MZ + b"YENI"
        import hashlib
        panel = FakePanel(files={"app.py": b"x\n"}, agent_version="3.5.4", exe=new_exe,
                          exe_version="3.5.4", exe_sha=hashlib.sha256(new_exe).hexdigest())
        self.addCleanup(panel.stop)
        updater.relaunch = lambda *a, **k: self.fail("açık işlem varken yeniden başlatılmamalı")

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home",
                                   can_restart=lambda: False)

        self.assertTrue(r.exe)
        self.assertTrue(r.pending)
        self.assertFalse(r.restarted)
        self.assertEqual(target.read_bytes(), new_exe)   # dosya yine de güncellendi

    def test_non_pe_payload_rejected(self):
        root = make_install(self.tmp / "app", version="3.5.3")
        target = self._frozen(root)
        target.write_bytes(MZ + b"ESKI")
        panel = FakePanel(files={}, agent_version="3.5.4", exe=b"bu bir exe degil", exe_version="9.9.9")
        self.addCleanup(panel.stop)

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")
        self.assertFalse(r.exe)
        self.assertEqual(target.read_bytes(), MZ + b"ESKI")
        self.assertTrue(any("MZ" in m for m in self.logs))

    def test_corrupt_exe_download_leaves_current_intact(self):
        root = make_install(self.tmp / "app", version="3.5.3")
        target = self._frozen(root)
        target.write_bytes(MZ + b"ESKI")
        panel = FakePanel(files={}, agent_version="3.5.4", exe=MZ + b"YENI", exe_version="9.9.9",
                          exe_sha="0" * 64)
        self.addCleanup(panel.stop)

        r = updater.startup_update(self.cfg(panel), self.log, root=root, home=self.tmp / "home")
        self.assertFalse(r.exe)
        self.assertEqual(target.read_bytes(), MZ + b"ESKI")
        self.assertFalse(target.with_name("JARVIS.exe.new").exists())


class TestBackup(UpdaterTestCase):
    def test_snapshot_and_rollback(self):
        root = make_install(self.tmp / "app", config={"mt5": {"login": 777}})
        home = self.tmp / "home"
        P.ensure_dirs(home)
        (home / "kanal_setup_locks.json").write_text('{"EURUSD|M5": {"side": "BUY"}}', encoding="utf-8")

        b = updater.snapshot(root, home, label="test")
        self.assertTrue((b / "config.json").exists())
        self.assertTrue((b / "kanal_setup_locks.json").exists())

        (root / "config.json").write_text('{"bozuk": true}', encoding="utf-8")
        (home / "kanal_setup_locks.json").write_text("{}", encoding="utf-8")

        updater.rollback(root, home, logger=self.log)
        self.assertEqual(json.loads((root / "config.json").read_text(encoding="utf-8"))["mt5"]["login"], 777)
        self.assertIn("BUY", (home / "kanal_setup_locks.json").read_text(encoding="utf-8"))

    def test_prune_keeps_last_n(self):
        home = self.tmp / "home"
        root = make_install(self.tmp / "app")
        for i in range(14):
            updater.snapshot(root, home, label=f"b{i}", keep=100)
        updater.prune_backups(home, keep=10)
        self.assertEqual(len(updater.list_backups(home)), 10)

    def test_rollback_without_backup_is_safe(self):
        self.assertIsNone(updater.rollback(self.tmp / "app", self.tmp / "home", logger=self.log))


if __name__ == "__main__":
    unittest.main(verbosity=2)
