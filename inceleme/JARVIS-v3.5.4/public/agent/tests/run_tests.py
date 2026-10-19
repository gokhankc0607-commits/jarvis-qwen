#!/usr/bin/env python3
"""
JARVIS ajan testleri — tek komutla hepsi.

    python tests/run_tests.py            # tümü
    python tests/run_tests.py -v         # ayrıntılı
    python tests/run_tests.py updater    # yalnızca updater testleri

Windows'ta `test_build.bat` ve CI'da `build.py --check` tarafından çağrılır.
Ek bağımlılık yoktur (yalnızca standart kütüphane + requests).
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
AGENT = HERE.parent
for p in (str(AGENT), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)


def main() -> int:
    args = [a for a in sys.argv[1:]]
    pattern = "test_*.py"
    if args and not args[0].startswith("-"):
        pattern = f"test_{args.pop(0)}*.py"
    suite = unittest.TestLoader().discover(str(HERE), pattern=pattern, top_level_dir=str(HERE))
    runner = unittest.TextTestRunner(verbosity=2 if "-v" in args else 1)
    res = runner.run(suite)
    return 0 if res.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
