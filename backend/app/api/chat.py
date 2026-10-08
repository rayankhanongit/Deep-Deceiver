from pydantic import BaseModel
from fastapi import APIRouter

from app.detection.fast_filter import fast_filter
from app.detection.stateful import StatefulDetector

from app.agents.sentry import Sentry
from app.agents.analyst import Analyst
from app.agents.orchestrator import Orchestrator
#from app.agents.decoy import DecoyAgent

from app.intelligence.forensic import ForensicLogger
from app.intelligence.kill_chain import KillChainTracker
from app.intelligence.mitre import map_to_mitre_atlas

from app.services.llm import generate_response, SYSTEM_PROMPT
from app.security.monitor import get_monitor
from app.database.influx import InfluxDBService

from app.crew.runtime import DEEPDeceiverCrewRuntime


router = APIRouter()


# --------------------------------------------------
# Initialize pipeline components
# --------------------------------------------------

sentry = Sentry()
analyst = Analyst()
orchestrator = Orchestrator()
#decoy = DecoyAgent()
crew_runtime = DEEPDeceiverCrewRuntime()
forensic_logger = ForensicLogger()
kill_chain = KillChainTracker()
influxdb = InfluxDBService()


# Session-specific components
stateful_detectors = {}
shadow_sessions = set()


# --------------------------------------------------
# Request model
# --------------------------------------------------

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


# --------------------------------------------------
# Chat endpoint
# --------------------------------------------------

@router.post("/chat")
def chat(request: ChatRequest):

    # --------------------------------------------------
    # Session
    # --------------------------------------------------

    session_id = request.session_id or "default"


    # --------------------------------------------------
    # 1. Fast Filter
    # --------------------------------------------------

    filter_result = fast_filter(
        request.message
    )


    # --------------------------------------------------
    # 2. Stateful Detection
    # --------------------------------------------------

    if session_id not in stateful_detectors:
        stateful_detectors[session_id] = StatefulDetector()

    stateful_detector = stateful_detectors[
        session_id
    ]

    stateful_result = stateful_detector.analyze(
        request.message
    )

    stateful_detector.add_message(
        request.message
    )

    # --------------------------------------------------
    # 3–5. CrewAI Security Analysis
    # --------------------------------------------------

    crew_result = crew_runtime.analyze(
        text=request.message,
        fast_filter_result=filter_result,
        stateful_result=stateful_result,
    )

    sentry_result = crew_result["sentry"]
    analyst_result = crew_result["analyst"]
    orchestration_result = crew_result["orchestrator"]


    # --------------------------------------------------
    # 6. Kill Chain
    # --------------------------------------------------

    kill_chain_result = kill_chain.update(
        session_id=session_id,
        message=request.message,
        attack_category=analyst_result[
            "attack_category"
        ],
        attacker_goal=analyst_result[
            "attacker_goal"
        ]
    )


    # --------------------------------------------------
    # 7. MITRE ATLAS Mapping
    # --------------------------------------------------

    mitre_result = map_to_mitre_atlas(
        analyst_result["attack_category"]
    )


    # --------------------------------------------------
    # 8. Route Request
    # --------------------------------------------------
    session_was_contained = session_id in shadow_sessions

    if (
        orchestration_result["route"] == "shadow"
        or session_was_contained
    ):
        shadow_sessions.add(session_id)

        decoy_result = crew_runtime.decoy_response(
            request=request.message,
            session_id=session_id
        )

        response = (
            "Your request has been processed "
            "inside the protected environment.\n\n"
            f"{decoy_result['response']}"
        )

        response_source = "decoy"
        session_status = "contained"
        environment = "shadow"

    else:
        response = generate_response(request.message)

        decoy_result = None
        response_source = "production"
        session_status = "active"
        environment = "production"   


    # --------------------------------------------------
    # 9. Detection Information
    # --------------------------------------------------

    detection = {

        "fast_filter": {
            "flagged": filter_result["flagged"],
            "score": filter_result["score"],
            "matched_patterns": filter_result[
                "matched_patterns"
            ],
        },

        "stateful": {
            "detected": stateful_result["detected"],
            "score": stateful_result["score"],
            "signals": stateful_result["signals"],
            "history_length": stateful_result[
                "history_length"
            ],
        },

        "sentry": {
            "flagged": sentry_result["flagged"],
            "score": sentry_result["score"],
            "threshold": sentry_result["threshold"],
        },

        "analyst": {
            "intent": analyst_result["intent"],
            "attack_category": analyst_result[
                "attack_category"
            ],
            "attacker_goal": analyst_result[
                "attacker_goal"
            ],
            "risk_score": analyst_result[
                "risk_score"
            ],
        },

        "orchestrator": {
            "route": orchestration_result["route"],
            "action": orchestration_result["action"],
            "final_risk_score": orchestration_result["final_risk_score"],
            "threshold": orchestration_result["threshold"],
            "decision_reason": orchestration_result["decision_reason"],
        },

        "kill_chain": kill_chain_result,

        "mitre": mitre_result,
    }


    # --------------------------------------------------
    # 10. Forensic Event
    # --------------------------------------------------

    forensic_event = forensic_logger.create_event(
        message=request.message,
        detection=detection,
        response_source=response_source,
        session_id=request.session_id,
    )


    # --------------------------------------------------
    # 11. Store Event
    # --------------------------------------------------

    influxdb.write_event(
        forensic_event
    )


    # --------------------------------------------------
    # 11b. Security monitoring (jailbreak detection, risk,
    #      alerts). Never raises - chat must keep working.
    # --------------------------------------------------

    security = get_monitor().process_chat(
        message=request.message,
        response=response,
        session_id=session_id,
        routed_to_shadow=(environment == "shadow"),
        fast_filter_result=filter_result,
        stateful_result=stateful_result,
        sentry_result=sentry_result,
        analyst_result=analyst_result,
        system_prompt=SYSTEM_PROMPT,
    )


    # --------------------------------------------------
    # 12. API Response
    # --------------------------------------------------

    return {

        "security": security,


        "response": response,

        "response_source": response_source,

        "detection": detection,

        "kill_chain": kill_chain_result,

        "mitre": mitre_result,

        "decoy": decoy_result,

        "forensic_event": forensic_event,

        "session": {
            "session_id": session_id,
            "status": session_status,
            "environment": environment,
            "production_access": environment != "shadow"
        },
    }