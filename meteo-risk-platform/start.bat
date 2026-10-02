@echo off
chcp 65001 >nul
title 高原草畜气象风险智能预警与决策平台 - 启动服务

echo ======================================================================
echo   第八届全球校园人工智能算法精英大赛 · 智慧气象算法主题赛
echo   面向青藏高原牧区的高原多源时空融合气象灾害预警与草畜平衡决策平台
echo ======================================================================
echo.

set PYTHON_CMD=python

:: 优先检测同级或上一级的 .venv 虚拟环境
if exist "..\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=..\.venv\Scripts\python.exe"
) else if exist ".venv\Scripts\python.exe" (
    set "PYTHON_CMD=.venv\Scripts\python.exe"
)

echo [1/3] 正在检查 Python 运行时环境: %PYTHON_CMD%
%PYTHON_CMD% --version
if errorlevel 1 (
    echo [错误] 未能检测到有效的 Python 环境，请安装 Python 3.10+ 或配置 PATH。
    pause
    exit /b 1
)

echo.
echo [2/3] 正在启动 FastAPI 后端核心微服务与静态站点 (端口: 8001)...
echo       服务地址: http://127.0.0.1:8001/
echo       API 文档: http://127.0.0.1:8001/docs
echo.

start "" "http://127.0.0.1:8001/"

echo [3/3] 服务正在运行中... (按 Ctrl+C 可终止服务)
echo ======================================================================
%PYTHON_CMD% -m uvicorn app.main:app --host 127.0.0.1 --port 8001

pause
