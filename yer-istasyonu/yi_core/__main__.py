"""Komut satırı.

    python -m yi_core                         # sunucu simülasyonu, http://127.0.0.1:8000
    python -m yi_core --port main=COM5 --port backup=COM6 --port payload=COM7 --baud 9600
    python -m yi_core --replay 20261120_101500_serial --speed 2
    python -m yi_core --list-ports
"""

from __future__ import annotations

import argparse
import logging
import webbrowser
from datetime import datetime
from pathlib import Path

import uvicorn

from .hub import Hub
from .server import SourceReq, create_app
from .sources import list_ports

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser(prog="yi_core", description="AKANA yer istasyonu telemetri sunucusu")
    ap.add_argument("--host", default="127.0.0.1", help="dinlenecek adres (varsayılan yalnızca bu bilgisayar)")
    ap.add_argument("--http-port", type=int, default=8000)
    ap.add_argument("--port", action="append", default=[], metavar="KAYNAK=PORT",
                    help="alıcı eşlemesi: main|backup|payload=COMx veya /dev/ttyUSBx (birden çok verilebilir)")
    ap.add_argument("--baud", type=int, default=9600, help="E22 UART hızı (varsayılan 9600)")
    ap.add_argument("--no-rssi-byte", action="store_true", help="E22 RSSI baytı eklemiyorsa")
    ap.add_argument("--replay", metavar="KAYIT", help="recordings/ altındaki bir kaydı oynat")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--sim-start", type=float, default=-30.0, help="simülasyon başlangıç görev zamanı (s)")
    ap.add_argument("--record-sim", action="store_true", help="simülasyon oturumunu da kaydet")
    ap.add_argument("--recordings", type=Path, default=ROOT / "recordings")
    ap.add_argument("--ui", type=Path, default=ROOT / "ui")
    ap.add_argument("--open", action="store_true", help="tarayıcıda aç")
    ap.add_argument("--app", action="store_true", help="masaüstü penceresinde aç (pywebview kuruluysa)")
    ap.add_argument("--list-ports", action="store_true")
    a = ap.parse_args()

    if a.list_ports:
        for p in list_ports():
            print(f"{p['device']:<16} {p['description']}")
        return

    (ROOT / "logs").mkdir(exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        handlers=[logging.StreamHandler(),
                                  logging.FileHandler(ROOT / "logs" / f"yi_{datetime.now():%Y%m%d_%H%M%S}.log", encoding="utf-8")])

    if a.port:
        ports = dict(p.split("=", 1) for p in a.port)
        initial = SourceReq(mode="serial", ports=ports, baud=a.baud)
    elif a.replay:
        initial = SourceReq(mode="replay", name=a.replay, speed=a.speed)
    else:
        initial = SourceReq(mode="sim", baud=a.baud)

    hub = Hub(a.recordings, rssi_byte=not a.no_rssi_byte)
    app = create_app(hub, a.ui, initial, record_sim=a.record_sim, sim_start=a.sim_start)
    url = f"http://{a.host}:{a.http_port}/"
    if a.app:
        try:
            import webview  # pywebview: Windows'ta Edge WebView2, macOS'ta WebKit kullanır
        except ImportError:
            logging.warning("pywebview kurulu değil (pip install pywebview); tarayıcı açılıyor")
        else:
            import threading
            server = uvicorn.Server(uvicorn.Config(app, host=a.host, port=a.http_port, log_level="warning"))
            threading.Thread(target=server.run, daemon=True).start()
            webview.create_window("AKANA Yer İstasyonu", url, width=1600, height=960, min_size=(1100, 700))
            webview.start()
            server.should_exit = True
            return
        a.open = True
    if a.open:
        threading_timer_open(url)
    uvicorn.run(app, host=a.host, port=a.http_port, log_level="warning")


def threading_timer_open(url: str) -> None:
    import threading
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()


if __name__ == "__main__":
    main()
