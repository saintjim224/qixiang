"""
MeteoRiskPlatform - 核心配置模块 (只读旧项目资产)
=============================================================================
规范遵循:
- 严格只读旧项目 yak-risk-platform 的 data_store 和 public_data
- 不修改旧系统任何文件
"""

from __future__ import annotations

import os
from pathlib import Path

# 项目路径定义
APP_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = APP_DIR.parent
WORKSPACE_ROOT = PROJECT_ROOT.parent

# 旧项目路径 (只读)
OLD_PROJECT_ROOT = WORKSPACE_ROOT / "yak-risk-platform"
DATA_STORE_DIR = OLD_PROJECT_ROOT / "backend" / "data_store"
PUBLIC_DATA_DIR = OLD_PROJECT_ROOT / "public_data"
BOUNDARIES_DIR = PUBLIC_DATA_DIR / "boundaries"
REGION_LIST_FILE = PUBLIC_DATA_DIR / "region_list.csv"
REGION_BOUNDS_FILE = PUBLIC_DATA_DIR / "region_bounds.json"

# 前端与文档路径
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DOCS_DIR = PROJECT_ROOT / "docs"
DATA_DIR = APP_DIR / "data"

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
