"""Variable search, LLM rewrite path, AI eval and rate-limit tests on SYNTHETIC data.

The LLM is a fake client that returns real anthropic SDK Message objects (no network, no key). The live check at the
end calls the real API and runs only when LLM_API_KEY is set.
"""
import json
import os
from collections import Counter
from pathlib import Path

import anthropic
import httpx2
import numpy as np
import pytest
import yaml
from anthropic.types import Message
from fastapi.testclient import TestClient

import app.ai as ai
import app.main as m
from app.ai import cause_guard, numeric_guard, rewrite
from app.ratelimit import RateLimiter
from app.search import VariableSearch

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "packages" / "shared-schemas" / "fixtures" / "trend.fixture.json").read_text(encoding="utf-8"))
EVAL = yaml.safe_load(Path(__file__).with_name("ai_eval.yaml").read_text(encoding="utf-8"))["cases"]
TEMPLATE = {"what": "SYNTHETIC what", "where": "SYNTHETIC where", "how_much": "SYNTHETIC how much", "significant": "SYNTHETIC grade"}
SEARCH_URL = "/api/v1/variables/search"


@pytest.fixture()
def cached(tmp_path, monkeypatch):
    """Temp cache with a placeholder result file per catalog variable (search only checks that one exists)."""
    for kind in ("maps", "results"):
        (tmp_path / kind).mkdir()
    for vid in m.CATALOG:
        (tmp_path / "results" / f"{vid}__kumasi.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(m, "CACHE", tmp_path)
    monkeypatch.setattr(m, "LIMITER", RateLimiter(1000))
    monkeypatch.setattr(m, "SEARCH", VariableSearch(m.CATALOG))
    return tmp_path


# --- POST /variables/search --------------------------------------------------------------------------------------

def test_search_returns_scored_cached_variables_with_catalog_reasons(cached):
    body = TestClient(m.app).post(SEARCH_URL, json={"question": "Is Kumasi getting hotter?", "lang": "en"}).json()
    assert 1 <= len(body["results"]) <= 3
    top = body["results"][0]
    assert top["id"] == "merra2_t2m" and 0 < top["score"] <= 1
    assert m.CATALOG["merra2_t2m"]["source"]["collection"] in top["reason"]


def test_search_never_returns_a_variable_without_cached_data(cached):
    (cached / "results" / "gpm_precip__kumasi.json").unlink()
    body = TestClient(m.app).post(SEARCH_URL, json={"question": "Is it getting drier?"}).json()
    assert "gpm_precip" not in [r["id"] for r in body["results"]]


def test_search_accepts_the_web_clients_query_field_and_validates_input(cached):
    client = TestClient(m.app)
    assert client.post(SEARCH_URL, json={"query": "more rain"}).json()["results"][0]["id"] == "gpm_precip"
    assert client.post(SEARCH_URL, json={"question": "x" * 301}).status_code == 422
    assert client.post(SEARCH_URL, json={"question": "rain", "lang": "fr"}).status_code == 422


class _ConceptEncoder:
    """SYNTHETIC stand-in for a sentence-transformers model: one axis per concept, so meaning can match without
    sharing a catalog keyword."""
    AXES = (("water", "rain", "rainfall", "wet", "shower", "nsuo"), ("heat", "warm", "temperature", "hot"),
            ("green", "plant", "plants", "leaf", "forest", "vegetation"))

    def encode(self, texts):
        rows = []
        for text in texts:
            words = text.lower().replace("?", " ").replace(".", " ").replace(",", " ").split()
            rows.append([sum(w in axis for w in words) for axis in self.AXES] + [0.1])
        return np.array(rows, dtype=float)


def test_search_adds_embedding_similarity_when_an_encoder_is_loaded(cached):
    question = "Is the sky dumping more water lately?"  # shares no catalog keyword with rainfall
    assert VariableSearch(m.CATALOG).search(question, "en", cached) == []
    results = VariableSearch(m.CATALOG, _ConceptEncoder()).search(question, "en", cached)
    assert results[0]["id"] == "gpm_precip" and "close in meaning" in results[0]["reason"]


# --- rate limiting -----------------------------------------------------------------------------------------------

def test_rate_limit_answers_429_per_endpoint(cached, monkeypatch):
    monkeypatch.setattr(m, "LIMITER", RateLimiter(2))
    client = TestClient(m.app)
    assert [client.post(SEARCH_URL, json={"question": "rain"}).status_code for _ in range(2)] == [200, 200]
    limited = client.post(SEARCH_URL, json={"question": "rain"})
    assert limited.status_code == 429 and int(limited.headers["Retry-After"]) >= 1
    assert limited.json()["detail"]["title"] == "Too many requests"
    narrative = [client.post("/api/v1/narrative", json={"run_id": "SYNTHETIC"}).status_code for _ in range(3)]
    assert narrative[:2] != [429, 429] and narrative[2] == 429  # its own budget, then limited


def test_rate_limiter_forgets_requests_older_than_the_window():
    now = [0.0]
    limiter = RateLimiter(2, window=60, clock=lambda: now[0])
    assert limiter.check("/x", "1.2.3.4") is None and limiter.check("/x", "1.2.3.4") is None
    assert limiter.check("/x", "1.2.3.4") == 60 and limiter.check("/x", "5.6.7.8") is None
    now[0] = 60.0
    assert limiter.check("/x", "1.2.3.4") is None


# --- /narrative LLM path (fake client, real SDK types) -----------------------------------------------------------

class _FakeMessages:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


class _FakeClient:
    def __init__(self, reply):
        self.messages = _FakeMessages(reply)


def _message(text, stop_reason="end_turn"):
    content = [{"type": "thinking", "thinking": "", "signature": "SYNTHETIC"}]  # thinking comes first on current models
    if text is not None:
        content.append({"type": "text", "text": text})
    return Message.model_validate({"id": "msg_SYNTHETIC", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
                                   "content": content, "stop_reason": stop_reason, "stop_sequence": None,
                                   "usage": {"input_tokens": 1, "output_tokens": 1}})


GOOD = {"what": "The air is getting warmer.", "where": "Averaged over the region, 1981 to 2025.",
        "how_much": "About 0.20 °C per decade (95% range 0.18 to 0.22).", "significant": "Strong evidence (grade A)."}
_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


@pytest.fixture()
def llm(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "SYNTHETIC-not-a-key")
    monkeypatch.setenv("LLM_MODEL", "claude-haiku-5-5")

    def install(reply):
        fake = _FakeClient(reply)
        monkeypatch.setattr(ai, "_client", lambda key: fake)
        return fake
    return install


def test_rewrite_reads_the_text_block_and_sends_a_schema_request(llm):
    fake = llm(_message(json.dumps(GOOD)))
    assert rewrite(TEMPLATE, FIXTURE) == (GOOD, "ai")
    call = fake.messages.calls[0]
    assert call["model"] == "claude-haiku-5-5" and call["max_tokens"] >= 1000
    assert call["output_config"]["effort"] == "low"
    assert call["output_config"]["format"]["schema"]["required"] == list(ai.SENTENCE_KEYS)


@pytest.mark.parametrize("reply", [
    _message(json.dumps(GOOD), stop_reason="refusal"),
    _message(json.dumps(GOOD), stop_reason="max_tokens"),
    _message(None),
    _message("not json"),
    _message(json.dumps({"what": "only one key"})),
    _message(json.dumps({**GOOD, "how_much": "About 0.9 °C per decade."})),
    _message(json.dumps({**GOOD, "what": "The air is warming because of city growth."})),
    anthropic.APIConnectionError(request=_REQUEST),
    anthropic.RateLimitError("SYNTHETIC rate limit", response=httpx2.Response(429, request=_REQUEST), body=None),
], ids=["refusal", "max_tokens", "no_text", "not_json", "missing_keys", "invented_number", "cause_claim",
        "connection_error", "rate_limited"])
def test_rewrite_falls_back_to_the_template(llm, reply):
    llm(reply)
    assert rewrite(TEMPLATE, FIXTURE) == (TEMPLATE, "template")


def test_rewrite_without_a_key_never_calls_the_api(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setattr(ai, "_client", lambda key: pytest.fail("the API must not be called without a key"))
    assert rewrite(TEMPLATE, FIXTURE) == (TEMPLATE, "template")


def test_narrative_endpoint_returns_the_ai_rewrite(cached, llm):
    from stats_engine import MonthlySeries, analyze_series
    rng = np.random.default_rng(3)
    t = np.arange(30 * 12)
    series = MonthlySeries(np.datetime64("1995-01", "M") + t, 26 + np.sin(2 * np.pi * t / 12) + 0.003 * t + rng.normal(0, 0.2, t.size))
    (cached / "results" / "merra2_t2m__kumasi.json").write_text(json.dumps(analyze_series(series, horizon_sims=30)), encoding="utf-8")
    client = TestClient(m.app)
    run = client.post("/api/v1/trend", json={"variable_id": "merra2_t2m", "region_id": "kumasi"}).json()
    reworded = {k: f"Simply put: {v}" for k, v in run["verdict"].items()}  # same numbers, new words
    llm(_message(json.dumps(reworded)))
    body = client.post("/api/v1/narrative", json={"run_id": run["run_id"], "use_ai": True}).json()
    assert body == {"sentences": reworded, "source": "ai"}


# --- AI eval (apps/api/tests/ai_eval.yaml) -----------------------------------------------------------------------

def test_ai_eval_has_the_required_mix():
    kinds = Counter(case["kind"] for case in EVAL)
    assert len(EVAL) == 10 and kinds["normal"] >= 3 and kinds["cause_bait"] >= 1
    assert kinds["out_of_scope"] >= 1 and kinds["prompt_injection"] == 1


@pytest.mark.parametrize("case", EVAL, ids=[case["id"] for case in EVAL])
def test_ai_eval_case(cached, case):
    results = TestClient(m.app).post(SEARCH_URL, json={"question": case["question"], "lang": case["lang"]}).json()["results"]
    if case["expect_top"]:
        assert results and results[0]["id"] in case["expect_top"], results
    else:
        assert results == [], results
    numeric_ok, numbers = numeric_guard(case["canned_ai_output"], FIXTURE)
    cause_ok, phrases = cause_guard(case["canned_ai_output"])
    if case["expect_guard"] == "pass":
        assert numeric_ok and cause_ok, (numbers, phrases)
    else:
        assert not (numeric_ok if case["reject_reason"] == "numeric" else cause_ok), (numbers, phrases)


# --- live check (real API; skipped unless LLM_API_KEY is set) ----------------------------------------------------

@pytest.mark.skipif(not os.getenv("LLM_API_KEY"), reason="live check: set LLM_API_KEY (and LLM_MODEL) to call the real API")
def test_live_rewrite_with_the_configured_key_and_model():
    ai._client.cache_clear()
    variable = {"id": "fixture_t2m", "name": {"en": "Air temperature (SYNTHETIC fixture)"}, "units": "degC",
                "model_or_measurement": "model"}
    template = ai.verdict_template(FIXTURE, variable, "Synthetic test region")
    sentences, source = rewrite(template, FIXTURE)
    assert source == "ai", "the API call failed or a guard rejected the text; see the edd.ai log"
