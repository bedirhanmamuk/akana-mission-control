"""Sahte E22 alıcısı: donanım olmadan seri yolu sınamak için sanal seri port (Linux/macOS pty).

    python tools/sahte_alici.py main backup        # her kaynak için bir sanal port açar, yollarını yazar
    python -m yi_core --port main=/dev/pts/5 --port backup=/dev/pts/6

Simülasyon modelinden gerçek zamanlı ikili çerçeveler yazar (aynı arızalar dahil). Windows'ta
com0com gibi bir sanal port çifti gerekir; bu betik yalnızca POSIX içindir.
"""

from __future__ import annotations

import argparse
import os
import pty
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from yi_core.flight_sim import SimTransmitter  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sources", nargs="+", choices=["main", "backup", "payload"])
    ap.add_argument("--start", type=float, default=-20.0, help="başlangıç görev zamanı (s)")
    ap.add_argument("--no-rssi", action="store_true")
    a = ap.parse_args()
    ends = {}
    for s in a.sources:
        master, slave = pty.openpty()
        os.set_blocking(master, False)
        ends[s] = (master, SimTransmitter(s, rssi_byte=not a.no_rssi))
        print(f"{s}={os.ttyname(slave)}", flush=True)
    for _, tx in ends.values():  # başlangıca kadar olanı atla
        tx.until(a.start)
    t0 = time.monotonic()
    while True:
        t = a.start + time.monotonic() - t0
        for master, tx in ends.values():
            for _, data in tx.until(t):
                try:
                    os.write(master, data)
                except (BlockingIOError, OSError):
                    pass  # okuyan yoksa tampon dolar; gerçek alıcıda da veri kaybolur
        time.sleep(0.01)


if __name__ == "__main__":
    main()
