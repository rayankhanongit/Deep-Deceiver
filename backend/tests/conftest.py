import os
import sys

# Make `app` importable no matter where pytest is launched from.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Tests that exercise the full chat pipeline act as the operator.
os.environ["OPERATOR_TOKEN"] = "pytest-operator-token"
OPERATOR_HEADERS = {"X-Operator-Token": "pytest-operator-token"}
