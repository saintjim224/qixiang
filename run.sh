#!/usr/bin/env bash
# 融天气象 - 高原多源时空融合气象灾害预警平台 · 启动脚本
#
# 说明: 本作品包可独立运行。数据已内嵌在 app/data/ 下，
#       不需要旧项目 yak-risk-platform/ 存在。
set -e

echo "======================================================================"
echo "  融天气象 - 高原多源时空融合气象灾害预警平台"
echo "  多源气象数据融合 · 灾害风险预警 · 草畜平衡决策"
echo "======================================================================"

# 优先使用作品包内自带的虚拟环境，其次系统 Python。
# 注意只找**包内**的 .venv：旧实现还会去找 ../.venv，
# 那台机器上传过来的是一个与该包无关的环境，装没装依赖全凭运气。
PYTHON_CMD=""
for candidate in ".venv/bin/python" ".venv/Scripts/python.exe" "python3" "python"; do
    if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then
        PYTHON_CMD="$candidate"
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "[错误] 未找到可用的 Python 解释器，请安装 Python 3.10+ 或配置 PATH。"
    exit 1
fi

echo "[1/3] Python 运行环境: $($PYTHON_CMD --version 2>&1)"
echo "[2/3] 检查依赖..."
if ! $PYTHON_CMD -c "import fastapi, uvicorn, numpy, sklearn" >/dev/null 2>&1; then
    echo "      缺少依赖，正在安装 requirements.txt ..."
    $PYTHON_CMD -m pip install -r requirements.txt
fi
echo "[3/3] 正在启动服务 (端口: 8001)..."
echo "      访问地址: http://127.0.0.1:8001/"
echo "      API 文档: http://127.0.0.1:8001/docs"
echo "======================================================================"

exec $PYTHON_CMD -m uvicorn app.main:app --host 127.0.0.1 --port 8001
