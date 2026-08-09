"""Gemini client with automatic model fallback chain.

Priority for interviews/conversation: gemini-2.5-flash-live (streaming).
Priority for generation (reports, resume scoring): gemini-2.5-flash,
then 2.5-flash-lite, then 3.5-flash-lite.

On any API error or timeout we automatically try the next model in the
chain and log the failure, so a single model outage never breaks a
session.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field

import httpx

from app.config import settings

logger = logging.getLogger("aurora.gemini")

AUTH_PARAM = ""


@dataclass
class GeminiAttempt:
    model: str
    success: bool
    latency_ms: int = 0
    error: str = ""


@dataclass
class GeminiResult:
    text: str
    model_used: str
    attempts: list[GeminiAttempt] = field(default_factory=list)
    fallback_used: bool = False


class GeminiClient:
    def __init__(self, timeout: int = settings.gemini_generation_timeout):
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=timeout)
        self.base = settings.gemini_base_url.rstrip("/")

    # ------------------------------------------------------------------
    # Low-level
    # ------------------------------------------------------------------
    def _headers(self) -> dict[str, str]:
        return {
            "x-goog-api-key": settings.gemini_api_key,
            "Content-Type": "application/json",
        }

    async def _generate(
        self,
        model: str,
        messages: list[dict[str, str]],
        system: str | None = None,
        temperature: float = 0.7,
        stream: bool = False,
        response_schema: dict | None = None,
    ) -> tuple[str, GeminiAttempt]:
        """Single attempt against one model. Returns (text, attempt)."""
        attempt = GeminiAttempt(model=model, success=False)
        start = time.monotonic()
        try:
            contents = [
                {"role": ("user" if m["role"] == "user" else "model"),
                 "parts": [{"text": m["text"]}]}
                for m in messages
            ]
            body: dict = {
                "contents": contents,
                "generationConfig": {
                    "temperature": temperature,
                },
            }
            if system:
                body["systemInstruction"] = {"parts": [{"text": system}]}
            if response_schema:
                body["generationConfig"]["responseMimeType"] = "application/json"
                body["generationConfig"]["responseSchema"] = response_schema

            endpoint = "streamGenerateContent" if stream else "generateContent"
            url = f"/models/{model}:{endpoint}"
            params = {"alt": "sse"} if stream else None

            resp = await self.client.post(
                f"{self.base}{url}",
                json=body,
                params=params,
                headers=self._headers(),
            )
            resp.raise_for_status()

            if stream:
                text = self._parse_stream(resp.text)
            else:
                data = resp.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"]

            attempt.success = True
            attempt.latency_ms = int((time.monotonic() - start) * 1000)
            return text, attempt
        except httpx.HTTPStatusError as exc:  # noqa: BLE001
            attempt.error = (
                f"HTTP {exc.response.status_code}: "
                f"{exc.response.text[:200]}"
            )
            attempt.latency_ms = int((time.monotonic() - start) * 1000)
            logger.warning("gemini attempt failed: %s", attempt.error)
            return "", attempt
        except Exception as exc:  # noqa: BLE001
            attempt.error = f"{type(exc).__name__}: {exc}"[:200]
            attempt.latency_ms = int((time.monotonic() - start) * 1000)
            logger.warning("gemini attempt failed: %s", attempt.error)
            return "", attempt

    @staticmethod
    def _parse_stream(sse_raw: str) -> str:
        out = []
        for line in sse_raw.splitlines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                continue
            try:
                chunk = json.loads(payload)
                text = chunk["candidates"][0]["content"]["parts"][0]["text"]
                out.append(text)
            except Exception:  # noqa: BLE001
                continue
        return "".join(out)

    # ------------------------------------------------------------------
    # High-level with fallback
    # ------------------------------------------------------------------
    async def generate_with_fallback(
        self,
        messages: list[dict[str, str]],
        system: str | None = None,
        temperature: float = 0.7,
        response_schema: dict | None = None,
    ) -> GeminiResult:
        """Try the generation model chain until one succeeds."""
        result = GeminiResult(text="", model_used="", attempts=[])
        for model in settings.gemini_generation_models:
            text, attempt = await self._generate(
                model, messages, system, temperature,
                response_schema=response_schema,
            )
            result.attempts.append(attempt)
            if attempt.success:
                result.text = text
                result.model_used = model
                result.fallback_used = len(result.attempts) > 1
                return result
        return result  # text="" signals all models failed

    async def generate_with_fallback_json(
        self,
        messages: list[dict[str, str]],
        system: str | None = None,
        response_schema: dict | None = None,
    ) -> GeminiResult | None:
        """Same but parses JSON output; returns None on total failure."""
        result = await self.generate_with_fallback(
            messages, system=system, temperature=0.3,
            response_schema=response_schema,
        )
        if not result.text:
            return None
        try:
            parsed = json.loads(result.text)
        except json.JSONDecodeError:
            return None
        return parsed, result

    async def close(self) -> None:
        await self.client.aclose()


client = GeminiClient()
