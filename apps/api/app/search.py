"""POST /variables/search: rank catalog variables for a plain-language question.

Keyword and synonym matching (catalog synonyms, names and typical questions) always runs. Embedding similarity is
added when sentence-transformers is installed and EMBEDDING_MODEL is set; the catalog is embedded once at startup.
Only variables with a cached map or result are returned (CLAUDE.md rule 5: the demo reads only from data/cache).
No question text is ever sent to an LLM.
"""
from __future__ import annotations

import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger("edd.search")
TOP_K = 3
EMBED_MIN = 0.35  # cosine similarity below this is not a match
_STOP = {"what", "when", "where", "which", "does", "have", "this", "that", "there", "here", "with", "from", "into",
         "about", "been", "being", "much", "many", "more", "most", "less", "than", "over", "under", "getting", "becoming"}


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    return " ".join(re.sub(r"[^\w\s]", " ", text).split())


def _content_words(text: str) -> set[str]:
    return {w for w in _normalise(text).split() if len(w) > 3 and w not in _STOP}


def load_encoder():
    """A sentence-transformers model when EMBEDDING_MODEL is set and the package is installed; otherwise None."""
    name = os.getenv("EMBEDDING_MODEL")
    if not name:
        return None
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        log.warning("EMBEDDING_MODEL is set but sentence-transformers is not installed; keyword search only")
        return None
    return SentenceTransformer(name)


def _unit_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.where(norms == 0, 1, norms)


class VariableSearch:
    def __init__(self, catalog: dict[str, dict[str, Any]], encoder=None):
        self.catalog = catalog
        self.ids = sorted(catalog)
        self.encoder = encoder
        self.embeddings = None
        if encoder is not None:  # once, at startup
            documents = [self._document(catalog[vid]) for vid in self.ids]
            self.embeddings = _unit_rows(np.asarray(encoder.encode(documents), dtype=float))

    @staticmethod
    def _document(var: dict[str, Any]) -> str:
        name = var.get("name", {})
        return ". ".join([name.get("en", ""), name.get("tw", ""), var.get("definition", {}).get("student", {}).get("en", ""),
                          ", ".join(var.get("synonyms", [])), *var.get("typical_questions", [])])

    @staticmethod
    def is_cached(vid: str, cache: Path) -> bool:
        return any(any((cache / kind).glob(f"{vid}__*.json")) for kind in ("maps", "results"))

    def _keyword(self, question: str, var: dict[str, Any]) -> tuple[float, list[str]]:
        """Score in 0..1 and the catalog terms that matched (synonyms count most, then names, then typical questions)."""
        text, words = f" {_normalise(question)} ", set(_normalise(question).split())
        raw, matched = 0.0, []
        for synonym in var.get("synonyms", []):
            s = _normalise(synonym)
            if (f" {s} " in text) if " " in s else (s in words):
                raw, matched = raw + 2, matched + [synonym]
            elif len(s) > 3 and any(len(w) > 3 and (w.startswith(s) or s.startswith(w)) for w in words):
                raw, matched = raw + 1, matched + [synonym]
        name = var.get("name", {})
        for word in _content_words(f"{name.get('en', '')} {name.get('tw', '')}") & words:
            raw, matched = raw + 1, matched + [word]
        overlap = sorted(set().union(*map(_content_words, var.get("typical_questions", []) or [""])) & words - set(matched))
        raw, matched = raw + 0.5 * len(overlap), matched + overlap
        return min(1.0, raw / 4), list(dict.fromkeys(matched))

    def _reason(self, var: dict[str, Any], matched: list[str], similar_question: str | None, lang: str) -> str:
        name = var.get("name", {})
        label = name.get("en", var.get("id", ""))
        if lang == "tw" and name.get("tw"):
            label = f"{name['tw']} ({label})"
        source = var.get("source", {})
        where = f"{source.get('collection', '')} {source.get('version', '')}, {var.get('units', '')}".strip(", ")
        if matched:
            terms = ", ".join(f'"{t}"' for t in matched[:3])
            return f"{label}: the question matches {terms} in this variable's catalog entry ({where})."
        return f'{label}: the question is close in meaning to "{similar_question}" ({where}).'

    def search(self, question: str, lang: str, cache: Path) -> list[dict[str, Any]]:
        sims = None
        if self.encoder is not None and self.embeddings is not None:
            query = _unit_rows(np.asarray(self.encoder.encode([question]), dtype=float))[0]
            sims = self.embeddings @ query
        ranked = []
        for i, vid in enumerate(self.ids):
            var = self.catalog[vid]
            keyword, matched = self._keyword(question, var)
            similarity = float(sims[i]) if sims is not None else 0.0
            score = max(keyword, similarity if similarity >= EMBED_MIN else 0.0)
            if score <= 0 or not self.is_cached(vid, cache):
                continue
            similar = None
            if not matched and self.encoder is not None and var.get("typical_questions"):
                vectors = _unit_rows(np.asarray(self.encoder.encode(var["typical_questions"]), dtype=float))
                q = _unit_rows(np.asarray(self.encoder.encode([question]), dtype=float))[0]
                similar = var["typical_questions"][int(np.argmax(vectors @ q))]
            ranked.append({"id": vid, "name": var.get("name", {}).get("en", vid), "score": round(score, 3),
                           "reason": self._reason(var, matched, similar, lang)})
        return sorted(ranked, key=lambda r: (-r["score"], r["id"]))[:TOP_K]
