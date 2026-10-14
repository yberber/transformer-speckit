# Live-mode inference service for a Hugging Face Docker Space (research R3, R21).
#
# The build context is backend/ with the repo-root contracts/ staged next to it (the Space
# deploy does this; see the README). The pinned GPT-2 weights are baked into the image, so a
# cold start never downloads the model and the container runs offline.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.10 /uv /uvx /bin/

# Hugging Face Spaces run the container as UID 1000.
RUN useradd --create-home --uid 1000 user && mkdir /app && chown user:user /app
USER user
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

# Runtime dependencies only, from the lockfile.
COPY --chown=user:user pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY --chown=user:user app/ ./app/
RUN uv run --no-sync python -m app.core.model --download

COPY --chown=user:user contracts/ /app/contracts/

ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    LIMITS_PATH=/app/contracts/limits.json

EXPOSE 7860
# --no-access-log: uvicorn's access log records paths and client addresses (Principle IV).
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log"]
