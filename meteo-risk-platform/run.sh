#!/usr/bin/env bash
set -e

echo "======================================================================"
echo "  第八届全球校园人工智能算法精英大赛 · 智慧气象算法主题赛"
echo "  面向青藏高原牧区的高原多源时空融合气象灾害预警与草畜平衡决策平台"
echo "======================================================================"

PYTHON_CMD="python3"
if [ -f "../.venv/bin/python" ]; then
    PYTHON_CMD="../.venv/bin/python"
elif [ -f ".venv/bin/python" ]; then
    PYTHON_CMD=".venv/bin/python"
fi

echo "[1/3] 检测 Python 运行环境: $($PYTHON_CMD --version)"
echo "[2/3] 正在启动 FastAPI 后端服务 (端口: 8001)..."
echo "      访问地址: http://127.0.0.1:8001/"
echo "      API 文档: http://127.0.0.1:8001/docs"
echo "[3/3] 服务正在运行中... (按 Ctrl+C 终止)"
echo "======================================================================"

$PYTHON_CMD -m uvicorn app.main:app --host 127.0.0.1 --port 8001
