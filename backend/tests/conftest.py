import os
import sys

# Make `app` importable no matter where pytest is launched from.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
