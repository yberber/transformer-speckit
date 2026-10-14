import base64

import numpy as np
import pytest

from app.core.encode import (
    U16_SCALE,
    encoded_array,
    pack_causal,
    quantize_u16,
    sha256_hex,
    sig7,
    to_le_bytes,
)


def _causal_rows(rng: np.random.Generator, heads: int, t: int) -> np.ndarray:
    """Random row-stochastic causal attention [H, T, T] (future entries 0)."""
    att = rng.random((heads, t, t)) * np.tril(np.ones((t, t)))
    return att / att.sum(axis=-1, keepdims=True)


@pytest.mark.parametrize("t", [1, 2, 3, 4, 5])
def test_pack_causal_indices(t: int) -> None:
    # Encode (i, j) in each cell so the packed position of every entry is visible.
    att = np.zeros((2, t, t))
    for i in range(t):
        for j in range(t):
            att[:, i, j] = 100 * i + j
    packed = pack_causal(att)
    assert packed.shape == (2, t * (t + 1) // 2)
    for i in range(t):
        for j in range(i + 1):
            assert packed[0, i * (i + 1) // 2 + j] == 100 * i + j
            assert packed[1, i * (i + 1) // 2 + j] == 100 * i + j


def test_pack_causal_prefix_property() -> None:
    rng = np.random.default_rng(0)
    att = _causal_rows(rng, heads=3, t=7)
    full = pack_causal(att)
    for t in range(1, 8):
        n = t * (t + 1) // 2
        np.testing.assert_array_equal(full[:, :n], pack_causal(att[:, :t, :t]))


def test_pack_causal_rejects_non_square() -> None:
    with pytest.raises(ValueError):
        pack_causal(np.zeros((2, 3, 4)))


def test_quantize_u16_max_error() -> None:
    rng = np.random.default_rng(1)
    w = np.concatenate([rng.random(100_000), [0.0, 1.0, 0.5, 1 / 3]])
    q, scale = quantize_u16(w)
    assert q.dtype == np.uint16
    assert scale == U16_SCALE == 1 / 65535
    assert q.min() >= 0 and q.max() <= 65535
    # Half a quantization step, 0.5/65535 ≈ 7.63e-6 (example-data.md rounds it to "7.6e-6").
    assert np.max(np.abs(q * scale - w)) <= 0.5 / 65535 + 1e-15


def test_quantize_u16_clips() -> None:
    q, _ = quantize_u16(np.array([-0.1, 1.1]))
    assert q.tolist() == [0, 65535]


@pytest.mark.parametrize(
    ("dtype", "np_dtype", "values"),
    [
        ("float32", "<f4", [0.0, -1.5, 3.25, 1e-7, -2.0e30]),
        ("uint16", "<u2", [0, 1, 255, 256, 65535]),
    ],
)
def test_little_endian_base64_round_trip(dtype: str, np_dtype: str, values: list) -> None:
    arr = np.array(values).reshape(1, -1)
    raw = to_le_bytes(arr, dtype)  # type: ignore[arg-type]
    assert len(raw) == arr.size * np.dtype(np_dtype).itemsize
    np.testing.assert_array_equal(np.frombuffer(raw, dtype=np_dtype), np.array(values, np_dtype))

    enc = encoded_array(arr, dtype, scale=U16_SCALE if dtype == "uint16" else None)  # type: ignore[arg-type]
    assert enc["dtype"] == dtype
    assert enc["shape"] == [1, len(values)]
    assert ("scale" in enc) == (dtype == "uint16")
    decoded = np.frombuffer(base64.b64decode(enc["data"]), dtype=np_dtype).reshape(enc["shape"])
    np.testing.assert_array_equal(decoded, arr.astype(np_dtype))


def test_little_endian_byte_order() -> None:
    assert to_le_bytes(np.array([1]), "uint16") == b"\x01\x00"
    assert to_le_bytes(np.array([1.0]), "float32") == b"\x00\x00\x80\x3f"


def test_sha256_hex() -> None:
    assert sha256_hex(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


@pytest.mark.parametrize(
    ("x", "expected"),
    [
        (0.123456789, 0.1234568),
        (123.456789, 123.4568),
        (1.23456789e-9, 1.234568e-9),
        (99.99999999, 100.0),
        (1.0, 1.0),
        (0.0, 0.0),
    ],
)
def test_sig7(x: float, expected: float) -> None:
    assert sig7(x) == expected


def test_sig7_keeps_seven_significant_digits() -> None:
    rng = np.random.default_rng(2)
    for x in rng.random(1000) * 10.0 ** rng.integers(-8, 3, 1000):
        y = sig7(x)
        assert abs(y - x) <= 5e-7 * abs(x)
        assert len(f"{y:.6e}".split("e")[0].replace(".", "").rstrip("0")) <= 7
