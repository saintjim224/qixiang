import os
import sys
import tempfile
from pathlib import Path

# 将项目根目录加入 sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# 测试期间把"调度留痕"文件重定向到临时目录。
#
# 必须在 import app.* 之前设置：app/api/decision.py 在模块导入时就要解析出
# DISPATCH_LOG_FILE。否则每跑一次回归测试，都会往随作品交付的
# app/data/dispatch_logs.json 里追加一条 "Pytest 自动化审计验证"，交付包里
# 的样例审计流水会被测试噪声污染。
# 环境变量已存在时不覆盖，方便在需要时用真实文件手动跑。
os.environ.setdefault(
    "MR_DISPATCH_LOG",
    str(Path(tempfile.gettempdir()) / "meteo_risk_test_dispatch_logs.json"),
)
