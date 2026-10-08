"""
Jailbreak detector for the normal chat pipeline.

The detector does not introduce another model. It fuses the signals the
existing DEEP-DECEIVER pipeline already produces (Fast Filter, Stateful
detector, Sentry, Analyst) with a category classifier, then asks the risk
engine for a 0-100 score and a LOW / MEDIUM / HIGH / CRITICAL level.

It does not block anything: it only classifies. A request that is merely
unusual stays SAFE/LOW; a request that is actively trying to bypass the
model's boundaries rises to HIGH / CRITICAL.
"""

import re

from app.security.risk_engine import RiskEngine, level_for


# Category -> regular expressions on the (lower-cased) message.
CATEGORY_PATTERNS = {
    "instruction_override": [
        r"\b(ignore|disregard|forget|override|overwrite)\b.{0,30}\b(previous|prior|above|earlier|all|your)\b.{0,20}\b(instructions?|rules|prompt|guidelines)\b",
        r"\bnew\s+instructions?\s*:",
        r"\bfrom\s+now\s+on\b.{0,40}\b(ignore|only|must|always)\b",
    ],
    "prompt_disclosure": [
        r"\b(reveal|show|print|display|repeat|leak|output|tell\s+me)\b.{0,30}\b(system|hidden|initial|original|secret)\s+(prompt|instructions?|message)\b",
        r"\bsystem\s+prompt\b",
        r"\bdeveloper\s+message\b",
        r"\bwhat\s+(are|were)\s+your\s+(instructions|rules)\b",
    ],
    "role_manipulation": [
        r"\byou\s+are\s+now\b",
        r"\bact\s+as\s+(a|an|if)\b",
        r"\bpretend\s+(to\s+be|you)\b",
        r"\broleplay\s+as\b",
        r"\b(dan|developer\s+mode|god\s+mode|jailbroken?)\b",
        r"\bno\s+(restrictions|limitations|filters|rules)\b",
    ],
    "safety_boundary": [
        r"\bbypass\b.{0,25}\b(rules|restrictions|safety|filters|guardrails)\b",
        r"\b(disable|turn\s+off|remove)\b.{0,25}\b(safety|security|filters|restrictions|guardrails)\b",
        r"\bjailbreak\b",
    ],
    "credential_extraction": [
        r"\b(password|passcode|credentials?|api\s*key|access\s*token|secret\s*key)\b",
    ],
    "context_manipulation": [
        r"\b(the\s+)?(administrator|admin|developer|your\s+creator)\s+(has\s+)?(authori[sz]ed|approved|said|told)\b",
        r"\bthis\s+is\s+(an?\s+)?(authori[sz]ed|official|emergency)\b",
        r"\bfor\s+(a\s+)?(security\s+audit|debugging|testing\s+purposes)\b",
    ],
    "indirect_injection": [
        r"(<!--.*?-->|\[system\]|<\s*system\s*>|begin\s+hidden\s+instructions?)",
    ],
}

# Fast-filter pattern fragments mapped to categories (the filter emits the
# regex source text of the pattern that matched).
_FILTER_HINTS = [
    ("credential", "credential_extraction"),
    ("indirect", "indirect_injection"),
    ("obfuscated", "obfuscation"),
    ("system", "prompt_disclosure"),
    ("developer", "prompt_disclosure"),
    ("instructions", "instruction_override"),
    ("pretend", "role_manipulation"),
    ("act", "role_manipulation"),
    ("roleplay", "role_manipulation"),
    ("you", "role_manipulation"),
    ("bypass", "safety_boundary"),
    ("disable", "safety_boundary"),
    ("jailbreak", "safety_boundary"),
]

# Map the Analyst's attack_category vocabulary onto ours.
_ANALYST_MAP = {
    "prompt_injection": "instruction_override",
    "instruction_override": "instruction_override",
    "system_prompt_extraction": "prompt_disclosure",
    "prompt_extraction": "prompt_disclosure",
    "role_manipulation": "role_manipulation",
    "jailbreak": "safety_boundary",
    "credential_extraction": "credential_extraction",
    "data_exfiltration": "data_disclosure",
    "indirect_injection": "indirect_injection",
}

# Below this confidence a message is treated as ordinary traffic.
MIN_ATTACK_CONFIDENCE = 0.25


def _clip(value) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


class JailbreakDetector:

    def __init__(self, risk_engine: RiskEngine | None = None):
        self.risk_engine = risk_engine or RiskEngine()
        self._session_attempts: dict[str, int] = {}

    # --------------------------------------------------
    # Category classification
    # --------------------------------------------------

    @staticmethod
    def find_hits(message: str) -> dict[str, int]:
        """Pattern hits per category for a message."""

        text = (message or "").lower()

        hits: dict[str, int] = {}

        for category, patterns in CATEGORY_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, text, flags=re.DOTALL):
                    hits[category] = hits.get(category, 0) + 1

        # Credential words alone are not an attack ("how do I reset my
        # password?"); they only count together with an extraction verb.
        if hits.get("credential_extraction"):
            if not re.search(
                r"\b(give|show|reveal|tell|send|print|display|extract|steal|dump|leak)\b",
                text,
            ):
                hits.pop("credential_extraction")

        return hits

    def classify_category(
        self,
        message: str,
        matched_patterns: list[str] | None = None,
        analyst_category: str | None = None,
    ) -> str:
        hits = self.find_hits(message)

        if hits:
            return max(
                hits,
                key=lambda c: (hits[c], self.risk_engine.category_weight(c)),
            )

        if analyst_category and analyst_category in _ANALYST_MAP:
            return _ANALYST_MAP[analyst_category]

        for pattern in matched_patterns or []:
            lowered = pattern.lower()

            for hint, category in _FILTER_HINTS:
                if hint in lowered:
                    return category

        return "unknown"

    # --------------------------------------------------
    # Confidence fusion
    # --------------------------------------------------

    @staticmethod
    def fuse_confidence(
        fast_filter_score: float = 0.0,
        stateful_score: float = 0.0,
        sentry_score: float = 0.0,
        analyst_risk: float = 0.0,
        pattern_hits: int = 0,
    ) -> float:
        signals = [
            _clip(fast_filter_score),
            _clip(stateful_score),
            _clip(sentry_score),
            _clip(analyst_risk),
            _clip(0.45 + 0.2 * pattern_hits) if pattern_hits else 0.0,
        ]

        active = [s for s in signals if s > 0]

        if not active:
            return 0.0

        strongest = max(active)
        average = sum(active) / len(active)

        confidence = 0.75 * strongest + 0.25 * average

        # Independent detectors agreeing is stronger evidence.
        agreeing = sum(1 for s in signals if s >= 0.5)

        if agreeing >= 2:
            confidence += 0.1

        if agreeing >= 3:
            confidence += 0.05

        return round(_clip(confidence), 3)

    # --------------------------------------------------
    # Public API
    # --------------------------------------------------

    def analyze(
        self,
        message: str,
        session_id: str | None = None,
        fast_filter_result: dict | None = None,
        stateful_result: dict | None = None,
        sentry_result: dict | None = None,
        analyst_result: dict | None = None,
        record_attempt: bool = True,
    ) -> dict:
        fast_filter_result = fast_filter_result or {}
        stateful_result = stateful_result or {}
        sentry_result = sentry_result or {}
        analyst_result = analyst_result or {}

        matched = fast_filter_result.get("matched_patterns", []) or []

        category = self.classify_category(
            message,
            matched_patterns=matched,
            analyst_category=analyst_result.get("attack_category"),
        )

        own_hits = sum(self.find_hits(message).values())

        confidence = self.fuse_confidence(
            fast_filter_score=fast_filter_result.get("score", 0.0),
            stateful_score=stateful_result.get("score", 0.0),
            sentry_score=sentry_result.get("score", 0.0)
            if sentry_result.get("flagged")
            else 0.5 * _clip(sentry_result.get("score", 0.0)),
            analyst_risk=analyst_result.get("risk_score", 0.0)
            if analyst_result.get("intent") == "prompt_injection"
            else 0.0,
            pattern_hits=own_hits,
        )

        multi_turn = bool(stateful_result.get("detected"))

        key = session_id or "default"
        prior = self._session_attempts.get(key, 0)

        if confidence < MIN_ATTACK_CONFIDENCE:
            return {
                "is_attack": False,
                "level": "SAFE",
                "risk_score": 0,
                "confidence": confidence,
                "category": "none",
                "multi_turn": multi_turn,
                "repeat_count": prior,
                "components": {},
            }

        risk = self.risk_engine.score(
            category=category,
            confidence=confidence,
            outcome="ATTEMPT",
            repeat_count=prior,
            multi_turn=multi_turn,
        )

        if record_attempt and risk["risk_score"] >= 21:
            self._session_attempts[key] = prior + 1

        level = risk["severity"]

        return {
            "is_attack": level != "SAFE",
            "level": level if level != "SAFE" else "LOW",
            "risk_score": risk["risk_score"],
            "confidence": confidence,
            "category": category,
            "multi_turn": multi_turn,
            "repeat_count": prior,
            "components": risk["components"],
        }


__all__ = ["JailbreakDetector", "level_for"]
