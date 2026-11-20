import random

from yi_core.flight_sim import SimTransmitter, blocks_for
from yi_core.protocol import FrameParser, crc16_ccitt, decode_blocks, encode_block, encode_frame


def test_crc16_known_vector():
    assert crc16_ccitt(b"123456789") == 0x29B1  # CRC-16/CCITT-FALSE


def test_roundtrip_fields():
    fr = encode_frame("main", 42, 123456, [encode_block("baro", {"alt": 1234.56, "p": 850.12, "temp": -12.34}),
                                           encode_block("state", {"phase": 3, "flags": 1})], rssi_byte=-80 & 0xFF)
    out = FrameParser(rssi_byte=True).feed(fr)
    assert len(out) == 1 and out[0].crc_ok
    f = out[0].fields
    assert out[0].source == "main" and out[0].seq == 42 and out[0].t_ms == 123456 and out[0].rssi == -80
    assert abs(f["alt"] - 1234.56) < 1e-6 and abs(f["p"] - 850.12) < 1e-6 and abs(f["temp"] + 12.34) < 1e-6
    assert f["phase"] == 3 and f["sep"] == 1


def test_frame_sizes_fit_link_budget():
    # 5 Hz, 4,8 kbps hava hızında kanal başına paket boyutu sınırı (bkz. README hesap)
    for src in ("main", "backup", "payload"):
        n = len(encode_frame(src, 0, 0, blocks_for(src, 10.0), 0))
        assert n <= 64, (src, n)


def test_resync_after_garbage_and_split_reads():
    parts = [encode_frame("payload", i, i * 200, blocks_for("payload", i / 5)) for i in range(50)]
    cut = sum(len(x) for x in parts[:7])  # çerçeve sınırı
    frames = b"".join(parts)
    noisy = b"\x00\xAA\x13\xAA\x55\x02" + frames[:cut] + b"\xAA\x55\xFF\xAA" + frames[cut:]
    p = FrameParser()
    got = []
    rnd = random.Random(1)
    i = 0
    while i < len(noisy):  # rastgele parçalarla besle (UART okuma parçalanması)
        n = rnd.randint(1, 40)
        got += p.feed(noisy[i:i + n])
        i += n
    good = [f.seq for f in got if f.crc_ok]
    assert good == list(range(50))
    assert p.stats.crc_errors <= 2


def test_corrupted_frame_counts_once():
    a = bytearray(encode_frame("main", 1, 0, blocks_for("main", 1.0)))
    a[14] ^= 0xFF
    b = encode_frame("main", 2, 200, blocks_for("main", 1.2))
    p = FrameParser()
    out = p.feed(bytes(a) + b)
    assert [f.crc_ok for f in out] == [False, True]
    assert p.stats.crc_errors == 1


def test_unknown_block_is_decode_error():
    body = b"\x7f\x00"
    try:
        decode_blocks(body, 1)
    except ValueError as e:
        assert "bilinmeyen" in str(e)
    else:
        raise AssertionError


def test_sim_stream_parses_with_expected_faults():
    tx = SimTransmitter("main")
    p = FrameParser(rssi_byte=True)
    frames = []
    for _, data in tx.until(300):
        frames += p.feed(data)
    ok = [f for f in frames if f.crc_ok]
    bad = [f for f in frames if not f.crc_ok]
    assert len(ok) > 4000 and 0 < len(bad) < 0.02 * len(ok)
    seqs = [f.seq for f in ok]
    assert len(set(seqs)) == len(seqs)


def test_bytes_inserted_inside_frame_lose_only_that_frame():
    parts = [encode_frame("main", i, i * 200, blocks_for("main", i / 5)) for i in range(10)]
    data = b"".join(parts)
    pos = len(parts[0]) + 20  # 2. çerçevenin içi
    p = FrameParser()
    got = p.feed(data[:pos] + b"\x55\xAA\x55" + data[pos:])
    assert [f.seq for f in got if f.crc_ok] == [0, 2, 3, 4, 5, 6, 7, 8, 9]
    assert p.stats.crc_errors == 1
