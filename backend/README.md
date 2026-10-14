---
title: Inside the Transformer
emoji: 🔍
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Live-mode GPT-2 small API for Inside the Transformer
---

# Inside the Transformer: inference service

This Space runs the live mode of *Inside the Transformer*, a website that shows GPT-2 small
turning text into new text one token at a time, with real numbers. It is a small, stateless,
CPU-only API: it tokenizes a text, generates up to 64 tokens greedily with
`openai-community/gpt2` at a pinned revision, and returns tokens, predictions, attention weights
and embeddings for the website to show.

The API is described by `contracts/inference-api.openapi.yaml`. Its endpoints are
`GET /api/v1/health`, `POST /api/v1/runs`, `POST /api/v1/attention` and
`POST /api/v1/token-embeddings`. Only the origins in the `ALLOWED_ORIGINS` variable may call it
from a browser.

**Privacy.** Text sent to this service is used only to answer that one request. It is never
stored, never logged and never echoed back in errors. The service has no database, no
accounts and no analytics. Its request log holds only the method, the route, the status and the
duration, with no text, query string or client address.
