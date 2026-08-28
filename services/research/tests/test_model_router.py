from polytrend.config import Settings
from polytrend.model_router import ModelRouter


def test_openai_compatible_base_url_without_version() -> None:
    router = ModelRouter(Settings(openai_base_url="https://api.3366.ai"))

    assert router._openai_url("responses") == "https://api.3366.ai/v1/responses"
    assert router._openai_url("chat/completions") == "https://api.3366.ai/v1/chat/completions"


def test_openai_compatible_base_url_with_version() -> None:
    router = ModelRouter(Settings(openai_base_url="https://api.3366.ai/v1/"))

    assert router._openai_url("responses") == "https://api.3366.ai/v1/responses"


def test_takeaways_accept_chat_completion_json_object() -> None:
    text = '{"takeaways":["One","Two","Three"]}'

    assert ModelRouter._takeaways(text) == ["One", "Two", "Three"]
