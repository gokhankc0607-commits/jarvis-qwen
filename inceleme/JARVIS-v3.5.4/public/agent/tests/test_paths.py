"""jarvis_paths testleri — ayarların ve verilerin nerede durduğu."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import jarvis_paths as P  # noqa: E402


class TestPaths(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="jarvis-paths-"))
        self.env = {k: os.environ.get(k) for k in ("JARVIS_HOME", "JARVIS_PORTABLE", "APPDATA")}

    def tearDown(self):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_app_dir_is_module_dir(self):
        self.assertEqual(P.app_dir(), Path(__file__).resolve().parent.parent)

    def test_jarvis_home_wins(self):
        os.environ["JARVIS_HOME"] = str(self.tmp / "custom")
        self.assertEqual(P.data_home(self.tmp / "app"), self.tmp / "custom")

    def test_portable_marker_keeps_data_next_to_app(self):
        app = self.tmp / "app"
        app.mkdir()
        (app / "portable.txt").write_text("x", encoding="utf-8")
        os.environ.pop("JARVIS_HOME", None)
        self.assertTrue(P.is_portable(app))
        self.assertEqual(P.data_home(app), app / "JARVIS-Data")

    def test_portable_env(self):
        os.environ.pop("JARVIS_HOME", None)
        os.environ["JARVIS_PORTABLE"] = "1"
        self.assertTrue(P.is_portable(self.tmp))

    def test_installed_mode_uses_appdata(self):
        os.environ.pop("JARVIS_HOME", None)
        os.environ["APPDATA"] = str(self.tmp / "Roaming")
        app = self.tmp / "app"
        app.mkdir()
        self.assertFalse(P.is_portable(app))
        self.assertEqual(P.data_home(app), self.tmp / "Roaming" / "JARVIS")

    def test_config_next_to_app_and_fallback(self):
        app = self.tmp / "app"
        app.mkdir()
        self.assertEqual(P.config_path(app), app / "config.json")
        self.assertFalse(P.resolve_config(app, self.tmp).exists())  # hiçbiri yok -> yazma yeri
        (self.tmp / "config.json").write_text("{}", encoding="utf-8")
        self.assertEqual(P.resolve_config(app, self.tmp), self.tmp / "config.json")
        (app / "config.json").write_text("{}", encoding="utf-8")
        self.assertEqual(P.resolve_config(app, self.tmp), app / "config.json")

    def test_preserved_names(self):
        for n in ("config.json", "portable.txt", "kanal_setup_locks.json", "jarvis.db.tgz",
                  "logs", "voices", "models", "JARVIS-Data", "backups"):
            self.assertTrue(P.is_preserved(n), n)
            self.assertTrue(P.is_preserved("./" + n), n)
        for n in ("app.py", "mql5/KANAL_Strateji.mq5", "requirements.txt", "JARVIS.exe"):
            self.assertFalse(P.is_preserved(n), n)

    def test_ensure_dirs_creates_tree(self):
        home = P.ensure_dirs(self.tmp / "home")
        self.assertTrue(P.logs_dir(home).is_dir())
        self.assertTrue(P.backup_dir(home).is_dir())

    def test_describe_keys(self):
        d = P.describe()
        for k in ("frozen", "portable", "app_dir", "config", "data_home", "logs", "backups"):
            self.assertIn(k, d)


if __name__ == "__main__":
    unittest.main(verbosity=2)
