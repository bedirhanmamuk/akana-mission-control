import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from yi_core.hub import Hub
from yi_core.recorder import verify_recording
from yi_core.server import SourceReq, create_app


def _collect(ws, until, limit=400):
    msgs = []
    for _ in range(limit):
        m = json.loads(ws.receive_text())
        msgs.append(m)
        if until(msgs):
            break
    return msgs


def test_sim_session_streams_history_and_live(tmp_path: Path):
    hub = Hub(tmp_path / "rec")
    app = create_app(hub, None, SourceReq(mode="sim"), record_sim=True, sim_start=60.0)
    with TestClient(app) as c:
        st = c.get("/api/status").json()
        assert st["mode"] == "sim"
        with c.websocket_connect("/ws") as ws:
            msgs = _collect(ws, lambda ms: sum(len(m.get("items", [])) for m in ms if m["type"] == "pkts") > 5000)
        hello = next(m for m in msgs if m["type"] == "hello")
        assert hello["t0"] == 0.0 and hello["activation"] == -610.0
        pk = [p for m in msgs if m["type"] == "pkts" for p in m["items"]]
        srcs = {p["source_id"] for p in pk}
        assert srcs == {"main", "backup", "payload"}
        main = [p for p in pk if p["source_id"] == "main" and p["crc"]]
        # cihaz saati eşlemesi: ts, rx'e 20 ms içinde
        assert all(abs(p["ts"] - p["rx"]) < 0.05 for p in main[-50:])
        assert any(not p["crc"] for p in pk if p["source_id"] == "main")
        assert "phase" not in next(p for p in pk if p["source_id"] == "payload" and p["crc"])["fields"]
    recs = list((tmp_path / "rec").iterdir())
    assert len(recs) == 1 and recs[0].name.endswith("_sim")
    assert all(verify_recording(recs[0]).values())


def test_replay_reproduces_recording(tmp_path: Path):
    hub = Hub(tmp_path / "rec")
    app = create_app(hub, None, SourceReq(mode="sim"), record_sim=True, sim_start=5.0)
    with TestClient(app) as c:
        time.sleep(0.5)
        with c.websocket_connect("/ws") as ws:
            live = _collect(ws, lambda ms: any(m["type"] == "status" for m in ms))
        n_live = sum(len(m.get("items", [])) for m in live if m["type"] == "pkts")
        name = c.get("/api/recordings").json()["recordings"][0]["name"]
        # kaydı kapatmak için kaynağı değiştir, sonra oynat ve sona atla
        c.post("/api/source", json={"mode": "replay", "name": name, "speed": 1})
        r = c.post("/api/replay", json={"action": "seek", "t": 1e9})
        assert r.status_code == 200
        time.sleep(0.3)
        with c.websocket_connect("/ws") as ws:
            rep = _collect(ws, lambda ms: any(m["type"] == "status" for m in ms))
        n_rep = sum(len(m.get("items", [])) for m in rep if m["type"] == "pkts")
        hello = next(m for m in rep if m["type"] == "hello")
        assert hello["mode"] == "replay"
        assert n_rep >= n_live > 1000


def test_rejects_path_traversal_and_bad_mode(tmp_path: Path):
    hub = Hub(tmp_path / "rec")
    app = create_app(hub, None, SourceReq(mode="sim"))
    with TestClient(app) as c:
        assert c.post("/api/source", json={"mode": "replay", "name": "../etc"}).status_code == 400
        assert c.post("/api/source", json={"mode": "xyz"}).status_code == 400
        assert c.post("/api/source", json={"mode": "serial", "ports": {}}).status_code == 400


def test_no_code_path_writes_to_serial():
    src = (Path(__file__).parent.parent / "yi_core").rglob("*.py")
    for f in src:
        text = f.read_text(encoding="utf-8")
        assert "ser.write" not in text and ".write(b" not in text, f


def test_interrupted_recording_is_sealed_and_replayable(tmp_path: Path):
    from yi_core.recorder import Recorder, seal_interrupted
    from yi_core.flight_sim import SimTransmitter
    r = Recorder(tmp_path, "serial")
    for t, data in SimTransmitter("main").until(-560):
        r.raw("main", t, data)
    r._raw["main"].write("12.3\tabc")  # kesik son satır (çökme anı)
    r._raw["main"].flush()  # kapatılmadan bırakılır
    assert seal_interrupted(tmp_path) == [r.dir.name]
    info = json.loads((r.dir / "manifest.json").read_text(encoding="utf-8"))
    assert info["interrupted"] and "raw_main.txt" in info["sha256"]
    from yi_core.sources import Replay
    assert len(Replay(r.dir).items) > 50
