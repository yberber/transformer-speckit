"""Binary encoding shared by the example files and the API `EncodedArray` (example-data.md).

All arrays are raw little-endian, row-major, with no header. Attention is stored as the packed
causal lower triangle, quantized to uint16 with scale 1/65535.
"""

from __future__ import annotations

import base64
import hashlib
import math
from typing import Any, Literal

import numpy as np

Dtype = Literal["float32", "uint16"]

U16_MAX = 65535
U16_SCALE = 1 / U16_MAX

_LE_DTYPES: dict[str, np.dtype] = {"float32": np.dtype("<f4"), "uint16": np.dtype("<u2")}


def pack_causal(att: np.ndarray) -> np.ndarray:
    """[H, T, T] attention → [H, T(T+1)/2]; entry (i, j), j ≤ i, sits at i(i+1)/2 + j.

    The first t(t+1)/2 entries of each head are exactly the packing of the t-token prefix, so
    every generation step reads a prefix without re-packing.
    """
    if att.ndim != 3 or att.shape[1] != att.shape[2]:
        raise ValueError(f"expected [H, T, T], got {att.shape}")
    rows, cols = np.tril_indices(att.shape[1])  # row-major order: (0,0), (1,0), (1,1), ...
    return att[:, rows, cols]


def quantize_u16(w: np.ndarray) -> tuple[np.ndarray, float]:
    """Weights in [0, 1] → uint16 round(w × 65535), and the scale to multiply back."""
    q = np.clip(np.rint(np.asarray(w, dtype=np.float64) * U16_MAX), 0, U16_MAX)
    return q.astype(np.uint16), U16_SCALE


def to_le_bytes(arr: np.ndarray, dtype: Dtype) -> bytes:
    return np.ascontiguousarray(arr, dtype=_LE_DTYPES[dtype]).tobytes(order="C")


def encoded_array(arr: np.ndarray, dtype: Dtype, scale: float | None = None) -> dict[str, Any]:
    """The contract's `EncodedArray`: dtype, shape, optional scale, base64 data."""
    out: dict[str, Any] = {"dtype": dtype, "shape": [int(n) for n in arr.shape]}
    if scale is not None:
        out["scale"] = scale
    out["data"] = base64.b64encode(to_le_bytes(arr, dtype)).decode("ascii")
    return out


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sig7(x: float) -> float:
    """Round to 7 significant digits (probabilities and change percentages in JSON)."""
    x = float(x)
    if x == 0 or not math.isfinite(x):
        return x
    return float(f"{x:.6e}")
