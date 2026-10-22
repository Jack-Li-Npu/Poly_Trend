"""Export the server's canonical OpenAPI schema without starting providers."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/research/src"))
from polytrend.api import app

path = ROOT / "packages/contracts/openapi/polytrend.openapi.json"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(app.openapi(), indent=2) + "\n")
print(path.relative_to(ROOT))
