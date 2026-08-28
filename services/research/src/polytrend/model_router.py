from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings
from .models import MarketImpliedAnswer, MarketSnapshot


@dataclass(slots=True)
class ModelResult:
    takeaways: list[str]
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0


class ModelRouter:
    """Optional language layer; deterministic analytics always remain authoritative."""

    def __init__(self, config: Settings) -> None:
        self.config = config
        self.last_provider = "deterministic"
        self.last_error: str | None = None

    async def refine_takeaways(
        self,
        query: str,
        answer: MarketImpliedAnswer,
        markets: list[MarketSnapshot],
        deep_mode: bool,
    ) -> ModelResult:
        prompt = self._prompt(query, answer, markets)
        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            model = self.config.openai_deep_model if deep_mode else self.config.openai_model
            try:
                result = await self._openai(prompt, openai_key, model)
                self.last_provider, self.last_error = "openai", None
                return result
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                self.last_error = f"OpenAI: {type(exc).__name__}: {exc}"
        gemini_key = os.getenv("GEMINI_API_KEY")
        if gemini_key:
            try:
                result = await self._gemini(prompt, gemini_key, self.config.gemini_model)
                self.last_provider, self.last_error = "gemini", None
                return result
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                self.last_error = f"Gemini: {type(exc).__name__}: {exc}"
        self.last_provider = "deterministic"
        return ModelResult(takeaways=answer.takeaways[:3], provider="deterministic", model="template-v2")

    def _prompt(self, query: str, answer: MarketImpliedAnswer, markets: list[MarketSnapshot]) -> str:
        evidence = [
            {
                "id": market.id,
                "question": market.question,
                "probability": market.probability,
                "relation": market.relation_type.value,
                "included": market.id in answer.evidence_ids,
            }
            for market in markets
        ]
        return (
            "Write exactly three concise analyst takeaways as a JSON array of strings. "
            "Do not add a number not present in the supplied evidence. Do not claim objective truth. "
            "Proxies explain disagreement but may not alter the estimate.\n"
            + json.dumps({"query": query, "answer": answer.model_dump(mode="json"), "markets": evidence})
        )

    async def _openai(self, prompt: str, key: str, model: str) -> ModelResult:
        modes = (
            ["responses", "chat_completions"]
            if self.config.openai_api_mode == "auto"
            else [self.config.openai_api_mode]
        )
        first_error: Exception | None = None
        for mode in modes:
            try:
                if mode == "responses":
                    return await self._openai_responses(prompt, key, model)
                return await self._openai_chat_completions(prompt, key, model)
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                if first_error is None:
                    first_error = exc
                if len(modes) == 1 or mode == modes[-1]:
                    raise
        raise RuntimeError("OpenAI-compatible endpoint did not return a usable response") from first_error

    def _openai_url(self, route: str) -> str:
        base = self.config.openai_base_url.rstrip("/")
        versioned_base = base if base.endswith("/v1") else f"{base}/v1"
        return f"{versioned_base}/{route.lstrip('/')}"

    async def _openai_responses(self, prompt: str, key: str, model: str) -> ModelResult:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                self._openai_url("responses"),
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "input": prompt},
            )
            response.raise_for_status()
            payload = response.json()
        text = payload.get("output_text")
        if not text:
            text = payload["output"][0]["content"][0]["text"]
        takeaways = self._takeaways(text)
        usage = payload.get("usage", {})
        return ModelResult(
            takeaways=takeaways, provider="openai", model=model,
            input_tokens=int(usage.get("input_tokens", 0)), output_tokens=int(usage.get("output_tokens", 0)),
        )

    async def _openai_chat_completions(self, prompt: str, key: str, model: str) -> ModelResult:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                self._openai_url("chat/completions"),
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Return only the requested JSON. Never invent evidence.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
        text = payload["choices"][0]["message"]["content"]
        usage = payload.get("usage", {})
        return ModelResult(
            takeaways=self._takeaways(text),
            provider="openai",
            model=model,
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
        )

    async def _gemini(self, prompt: str, key: str, model: str) -> ModelResult:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                url, params={"key": key},
                json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}},
            )
            response.raise_for_status()
            payload = response.json()
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        usage = payload.get("usageMetadata", {})
        return ModelResult(
            takeaways=self._takeaways(text), provider="gemini", model=model,
            input_tokens=int(usage.get("promptTokenCount", 0)), output_tokens=int(usage.get("candidatesTokenCount", 0)),
        )

    @staticmethod
    def _takeaways(text: str) -> list[str]:
        decoded: Any = json.loads(text.strip().removeprefix("```json").removesuffix("```").strip())
        if isinstance(decoded, dict):
            decoded = decoded.get("takeaways")
        if not isinstance(decoded, list) or len(decoded) < 3:
            raise ValueError("model output did not contain three takeaways")
        result = [str(item).strip() for item in decoded[:3]]
        if any(not item or len(item) > 220 for item in result):
            raise ValueError("model takeaway failed length validation")
        return result

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok" if self.last_error is None else "degraded",
            "last_provider": self.last_provider,
            "last_error": self.last_error,
            "openai_configured": bool(os.getenv("OPENAI_API_KEY")),
            "openai_base_url": self.config.openai_base_url,
            "openai_api_mode": self.config.openai_api_mode,
            "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
        }
