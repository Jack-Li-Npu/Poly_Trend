from polytrend.config import Settings
from polytrend.model_router import ModelRouter


def test_openai_compatible_base_url_without_version() -> None:
    router = ModelRouter(Settings(openai_base_url="https://api.3366.ai"))

    assert router._openai_urls("responses") == [
        "https://api.3366.ai/responses",
        "https://api.3366.ai/v1/responses",
    ]
    assert router._openai_urls("chat/completions") == [
        "https://api.3366.ai/chat/completions",
        "https://api.3366.ai/v1/chat/completions",
    ]


def test_openai_compatible_base_url_with_version() -> None:
    router = ModelRouter(Settings(openai_base_url="https://api.3366.ai/v1/"))

    assert router._openai_urls("responses") == ["https://api.3366.ai/v1/responses"]


def test_official_openai_base_url_uses_v1() -> None:
    router = ModelRouter(Settings(openai_base_url="https://api.openai.com"))

    assert router._openai_urls("responses") == [
        "https://api.openai.com/v1/responses"
    ]


def test_takeaways_accept_chat_completion_json_object() -> None:
    text = '{"takeaways":["One","Two","Three"]}'

    assert ModelRouter._takeaways(text) == ["One", "Two", "Three"]


def test_responses_text_skips_non_message_output_items() -> None:
    payload = {
        "output": [
            {"type": "reasoning", "content": []},
            {
                "type": "message",
                "content": [{"type": "output_text", "text": '["One","Two","Three"]'}],
            },
        ]
    }

    assert ModelRouter._responses_text(payload) == '["One","Two","Three"]'
