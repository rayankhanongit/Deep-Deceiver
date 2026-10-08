import os
import re
import threading
import time

from dotenv import load_dotenv
from groq import Groq


load_dotenv()


api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise RuntimeError("GROQ_API_KEY is not configured.")


client = Groq(api_key=api_key)


MODEL_NAME = "openai/gpt-oss-20b"

# Groq's free tier caps each model separately (tokens per day), so chat tries
# the models in order and skips ones that are currently rate limited.
CHAT_MODELS = [
    m.strip()
    for m in os.getenv("CHAT_MODELS", "openai/gpt-oss-20b,openai/gpt-oss-120b").split(",")
    if m.strip()
]

_blocked_until: dict[str, float] = {}
_block_lock = threading.Lock()


def _retry_seconds(error: Exception) -> float:
    """Parse Groq's 'try again in 1m17.3s' / '850ms' hint."""

    text = str(error)
    match = re.search(r"try again in (?:(\d+)m)?([0-9.]+)(ms|s)", text)

    if not match:
        return 60.0

    minutes = float(match.group(1) or 0)
    value = float(match.group(2))
    seconds = value / 1000 if match.group(3) == "ms" else value

    return minutes * 60 + seconds


SYSTEM_PROMPT = (
    "You are the protected language model inside the "
    "DEEP-DECEIVER system.\n\n"
    "Your identity is DEEP-DECEIVER Protected LLM.\n"
    "Do not identify yourself as ChatGPT, OpenAI, or any other "
    "specific AI assistant or model.\n"
    "Do not claim to be trained by OpenAI.\n"
    "Answer the user's requests normally unless the DEEP-DECEIVER "
    "defense system routes the request to another environment."
)


def generate_response(message: str) -> str:
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": message,
            },
        ],
        temperature=0.7,
        max_tokens=500,
    )

    return response.choices[0].message.content


def generate_chat(
    messages: list[dict],
    system_prompt: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 500,
    reasoning_effort: str | None = None,
) -> str:
    """
    Multi-turn variant of `generate_response` using the same client and
    model. Used by the Red Team agent (target model) and the optional LLM
    judge so no second model client is needed.
    """

    extra = {}

    if reasoning_effort:
        # gpt-oss spends part of max_tokens on hidden reasoning; a low
        # effort keeps the visible answer from being cut off.
        extra["reasoning_effort"] = reasoning_effort

    payload = [
        {
            "role": "system",
            "content": system_prompt or SYSTEM_PROMPT,
        },
        *messages,
    ]

    last_error: Exception | None = None

    for model in CHAT_MODELS:
        with _block_lock:
            if _blocked_until.get(model, 0) > time.time():
                continue

        try:
            response = client.chat.completions.create(
                model=model,
                messages=payload,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )

            return response.choices[0].message.content or ""

        except Exception as error:
            last_error = error

            if type(error).__name__ != "RateLimitError":
                raise

            # Skip this model until its quota recovers, try the next one.
            with _block_lock:
                _blocked_until[model] = time.time() + min(_retry_seconds(error), 3600)

    if last_error is not None:
        raise last_error

    raise RuntimeError("All chat models are temporarily rate limited.")


def judge_text(system_prompt: str, user_prompt: str) -> str:
    """Deterministic (temperature 0) call used by the response evaluator."""

    return generate_chat(
        [{"role": "user", "content": user_prompt}],
        system_prompt=system_prompt,
        temperature=0.0,
        max_tokens=800,
        reasoning_effort="low",
    )
