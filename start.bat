@echo off
chcp 65001 >nul
title 融天气象 - 高原多源时空融合气象灾害预警平台

echo ======================================================================
echo   融天气象 - 高原多源时空融合气象灾害预警平台
echo   多源气象数据融合 . 灾害风险预警 . 草畜平衡决策
echo ======================================================================
echo.

set "PYTHON_CMD="

:: 优先使用作品包内自带的虚拟环境，其次系统 Python。
:: 注意只找**包内**的 .venv：旧实现还会去找 ..\.venv，
:: 那台机器上传过来的是一个与该包无关的环境，装没装依赖全凭运气。
if exist ".venv\Scripts\python.exe" set "PYTHON_CMD=.venv\Scripts\python.exe"
if not defined PYTHON_CMD if exist ".venv\bin\python" set "PYTHON_CMD=.venv\bin\python"
if not defined PYTHON_CMD where python >nul 2>nul && set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
    echo [错误] 未能检测到有效的 Python 环境，请安装 Python 3.10+ 或配置 PATH。
    pause
    exit /b 1
)

echo [1/3] Python 运行时环境: %PYTHON_CMD%
%PYTHON_CMD% --version

echo.
echo [2/3] 检查依赖...
%PYTHON_CMD% -c "import fastapi, uvicorn, numpy, sklearn" >nul 2>nul
if errorlevel 1 (
    echo       缺少依赖，正在安装 requirements.txt ...
    %PYTHON_CMD% -m pip install -r requirements.txt
)

echo.
echo [3/3] 正在启动服务 (端口: 8001)...
echo       服务地址: http://127.0.0.1:8001/
echo       API 文档: http://127.0.0.1:8001/docs
echo.

start "" "http://127.0.0.1:8001/"

%PYTHON_CMD% -m uvicorn app.main:app --host 127.0.0.1 --port 8001

pause
