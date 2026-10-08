"""
MeteoRiskPlatform - 核心配置模块
=============================================================================
数据根解析规则 (独立交付的关键):
- **优先**使用作品包内自带的 `app/data/`（由 tools/sync_data.py 从旧项目只读复制）；
- 找不到时才回退到旧项目 `yak-risk-platform/` 并打印警告。

原实现无条件指向 `../yak-risk-platform/`，用户拿到作品包后一旦旧项目不在原位，
所有接口都会静默返回空列表——包看着能跑，页面全是空的。
"""

from __future__ import annotations

import os
from pathlib import Path

# 项目路径定义
APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parent
WORKSPACE_ROOT = PROJECT_ROOT.parent

# 前端与文档路径
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DOCS_DIR = PROJECT_ROOT / "docs"
DATA_DIR = APP_DIR / "data"

# 作品包内自带数据 (首选)
LOCAL_DATA_STORE_DIR = DATA_DIR / "data_store"
LOCAL_PUBLIC_DATA_DIR = DATA_DIR / "public_data"

# 旧项目路径 (只读回退)
OLD_PROJECT_ROOT = WORKSPACE_ROOT / "yak-risk-platform"
_OLD_DATA_STORE_DIR = OLD_PROJECT_ROOT / "backend" / "data_store"
_OLD_PUBLIC_DATA_DIR = OLD_PROJECT_ROOT / "public_data"

# 判定"包内数据是否就绪"：以数据底座中最核心的 weather_data.json 为准，
# 只认这个文件，避免 data_store 目录只复制了一半就误判为可用。
_PACKAGED_READY = (LOCAL_DATA_STORE_DIR / "weather_data.json").exists()

if _PACKAGED_READY:
    DATA_STORE_DIR = LOCAL_DATA_STORE_DIR
    PUBLIC_DATA_DIR = LOCAL_PUBLIC_DATA_DIR
    DATA_SOURCE_MODE = "packaged"
else:
    DATA_STORE_DIR = _OLD_DATA_STORE_DIR
    PUBLIC_DATA_DIR = _OLD_PUBLIC_DATA_DIR
    DATA_SOURCE_MODE = "legacy_project"
    print(
        "[config] 警告: 未找到作品包内数据 app/data/data_store/weather_data.json，"
        f"已回退到旧项目目录 {DATA_STORE_DIR}。\n"
        "         本作品应可独立运行；如需独立交付，请先执行: python tools/sync_data.py"
    )

BOUNDARIES_DIR = PUBLIC_DATA_DIR / "boundaries"
REGION_LIST_FILE = PUBLIC_DATA_DIR / "region_list.csv"
REGION_BOUNDS_FILE = PUBLIC_DATA_DIR / "region_bounds.json"

# 外部天气接口配置 (可从环境变量读取)
OPEN_METEO_ENDPOINT = os.environ.get(
    "OPEN_METEO_ENDPOINT",
    "https://api.open-meteo.com/v1/forecast"
)
AMAP_WEB_SERVICE_KEY = os.environ.get("AMAP_WEB_SERVICE_KEY", "")

# 气象科学标准常量
GB_SNOW_STANDARDS = {
    "light": {"min_depth_cm": 5.0, "min_days": 3, "level_cn": "轻度雪灾 (I级)"},
    "moderate": {"min_depth_cm": 10.0, "min_days": 5, "level_cn": "中度雪灾 (II级)"},
    "heavy": {"min_depth_cm": 15.0, "min_days": 7, "level_cn": "重度雪灾 (III级)"},
    "severe": {"min_depth_cm": 20.0, "min_days": 10, "level_cn": "特重雪灾 (IV级)"}
}

# 高程气温垂直递减率 (青藏高原经验值 0.0065 °C/m)
TEMPERATURE_LAPSE_RATE = 0.0065
