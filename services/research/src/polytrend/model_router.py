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
            except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
                self.last_error = f"OpenAI: {type(exc).__name__}: {exc}"
        gemini_key = os.getenv("GEMINI_API_KEY")
        if gemini_key:
            try:
                result = await self._gemini(prompt, gemini_key, self.config.gemini_model)
                self.last_provider, self.last_error = "gemini", None
                return result
            except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
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

    def _openai_urls(self, route: str) -> list[str]:
        base = self.config.openai_base_url.rstrip("/")
        route = route.lstrip("/")
        if base.endswith("/v1"):
            return [f"{base}/{route}"]
        if base == "https://api.openai.com":
            return [f"{base}/v1/{route}"]
        # Codex-oriented gateways commonly expose /responses at the root, while
        # general OpenAI-compatible gateways often retain the /v1 prefix.
        return [f"{base}/{route}", f"{base}/v1/{route}"]

    async def _openai_post(
        self,
        route: str,
        key: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        urls = self._openai_urls(route)
        async with httpx.AsyncClient(timeout=20) as client:
            for index, url in enumerate(urls):
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {key}"},
                    json=payload,
                )
                if response.status_code in {404, 405} and index < len(urls) - 1:
                    continue
                response.raise_for_status()
                return response.json()
        raise RuntimeError("OpenAI-compatible endpoint did not return a response")

    async def _openai_responses(self, prompt: str, key: str, model: str) -> ModelResult:
        payload = await self._openai_post(
            "responses", key, {"model": model, "input": prompt}
        )
        text = self._responses_text(payload)
        takeaways = self._takeaways(text)
        usage = payload.get("usage", {})
        return ModelResult(
            takeaways=takeaways, provider="openai", model=model,
            input_tokens=int(usage.get("input_tokens", 0)), output_tokens=int(usage.get("output_tokens", 0)),
        )

    async def _openai_chat_completions(self, prompt: str, key: str, model: str) -> ModelResult:
        payload = await self._openai_post(
            "chat/completions",
            key,
            {
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
    def _responses_text(payload: dict[str, Any]) -> str:
        output_text = payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text
        for item in payload.get("output", []):
            if not isinstance(item, dict):
                continue
            for content in item.get("content", []):
                if not isinstance(content, dict):
                    continue
                text = content.get("text")
                if content.get("type") == "output_text" and isinstance(text, str) and text.strip():
                    return text
        raise ValueError("Responses API payload did not contain output text")

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
