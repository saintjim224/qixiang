"""复现末年留出诊断，并保存划分索引、源文件摘要与环境版本。"""
from pathlib import Path
import hashlib
import json
import platform
import sys
from importlib.metadata import version
from importlib.metadata import PackageNotFoundError
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.algorithm.pu_evaluation import run_pu_evaluation


def main():
    report = run_pu_evaluation()
    packages = {}
    for name in ("numpy", "scikit-learn", "xgboost", "pulearn"):
        try:
            packages[name] = version(name)
        except PackageNotFoundError:
            packages[name] = None
    sources = [
        ROOT / "app/algorithm/pu_model.py", ROOT / "app/algorithm/pu_evaluation.py",
        ROOT / "app/core/dataio.py",
        *sorted((ROOT / "app/data/data_store").glob("*.json")),
    ]
    report["reproducibility"] = {
        "python": platform.python_version(),
        "generated_at": datetime.now().astimezone().isoformat(),
        "packages": packages,
        "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
        "command": "python tools/evaluate_pu.py",
    }
    target = ROOT / "tools/out/pu_temporal_evaluation.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report: {target}")
    print(json.dumps({"evaluation": {k:v for k,v in report["evaluation"].items() if not k.endswith("indices")},
                      "models": report["benchmark_results"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
