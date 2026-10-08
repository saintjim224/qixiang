"""
MeteoRiskPlatform - 数据输入输出与语义校正层 (只读旧数据)
=============================================================================
规范遵循:
- §5.0: 针对 real_labels_1500.json 彻底修正语义:
        仅有 source_url/url 凭证的标 label_status="positive",
        其余标 label_status="unlabeled", 绝不将未标注等同于负样本。
- 严格只读旧项目 JSON 文件与 CSV 清单。
"""

from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import (
    DATA_STORE_DIR,
    REGION_LIST_FILE,
    REGION_BOUNDS_FILE,
    BOUNDARIES_DIR,
)

# 内存数据缓存
_STORE_CACHE: dict[str, list[dict[str, Any]]] = {}


def load_table(table_name: str, force_reload: bool = False) -> list[dict[str, Any]]:
    """读取指定 JSON 表数据 (带内存缓存)。"""
    if not force_reload and table_name in _STORE_CACHE:
        return _STORE_CACHE[table_name]

    file_path = DATA_STORE_DIR / f"{table_name}.json"
    if not file_path.exists():
        return []

    try:
        content = json.loads(file_path.read_text(encoding="utf-8"))
        if isinstance(content, list):
            rows = content
        elif isinstance(content, dict):
            rows = [content]
        else:
            rows = []
    except Exception as e:
        print(f"[dataio] 警告: 读取 {table_name}.json 失败: {e}")
        rows = []

    # §5.0 针对 real_labels_1500 的核心语义修正
    if table_name == "real_labels_1500":
        rows = _sanitize_real_labels(rows)

    _STORE_CACHE[table_name] = rows
    return rows


def _sanitize_real_labels(raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    §5.0 语义修正:
    1500 条数据中，仅有 source_url 或 url 的为真实正样本 (127条)；
    其余 1373 条无报道月份标为 unlabeled (未标注)，严禁作为真实负例。
    """
    sanitized: list[dict[str, Any]] = []
    for r in raw_rows:
        row = dict(r)
        url = (row.get("source_url") or row.get("url") or "").strip()
        if url:
            row["label_status"] = "positive"
            row["is_positive"] = True
            row["data_source"] = "verified_disaster_report"
        else:
            row["label_status"] = "unlabeled"
            row["is_positive"] = False
            row["data_source"] = "unlabeled_background"
        sanitized.append(row)
    return sanitized


@lru_cache(maxsize=1)
def load_region_list() -> list[dict[str, Any]]:
    """读取 26 个典型县域清单 (region_list.csv)。"""
    if not REGION_LIST_FILE.exists():
        return []
    with open(REGION_LIST_FILE, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def get_region_meta(region_id: str) -> dict[str, Any] | None:
    """获取单个县的元数据 (经纬度、海拔、主要草场类型等)。"""
    for r in load_region_list():
        if r.get("region_id") == region_id:
            return r
    return None


def get_weather_series(region_id: str) -> list[dict[str, Any]]:
    """获取指定县域的历史月度气象序列 (随包 CMFD 子集，2015-2024)。"""
    all_weather = load_table("weather_data")
    return [r for r in all_weather if r.get("region_id") == region_id]


def get_era5_daily(region_id: str) -> list[dict[str, Any]]:
    """获取指定县域的逐日 ERA5 气象记录 (随包数据，2020-2025，共 2192 天)。"""
    era5_all = load_table("climate_era5")
    if not era5_all:
        return []
    if isinstance(era5_all, list) and len(era5_all) == 1 and isinstance(era5_all[0], dict) and region_id in era5_all[0]:
        return era5_all[0][region_id]
    if isinstance(era5_all, dict) and region_id in era5_all:
        return era5_all[region_id]
    return [r for r in era5_all if r.get("region_id") == region_id]


def get_remote_sensing_series(region_id: str) -> list[dict[str, Any]]:
    """获取指定县域的遥感时间序列 (NDVI, 积雪覆盖率, NPP等)。"""
    all_rs = load_table("remote_sensing_data")
    return [r for r in all_rs if r.get("region_id") == region_id]


def get_npp_by_region(region_id: str) -> dict[str, Any] | None:
    """获取指定县域的 25 年 MOD17A3HGF NPP 年度数据。"""
    npp_all = load_table("npp_by_region")
    for r in npp_all:
        if r.get("region_id") == region_id:
            return r
    return None


def get_phenology_by_region(region_id: str) -> dict[str, Any] | None:
    """获取指定县域的 22 年 MCD12Q2 物候数据 (2003-2024)。"""
    pheno_all = load_table("phenology_by_region")
    for r in pheno_all:
        if r.get("region_id") == region_id:
            return r
    return None


def get_pu_labeled_dataset() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    返回 PU 学习数据集:
    - positives: 127 条确证正例
    - unlabeled: 1373 条未标注样本
    """
    labels = load_table("real_labels_1500")
    positives = [r for r in labels if r.get("label_status") == "positive"]
    unlabeled = [r for r in labels if r.get("label_status") == "unlabeled"]
    return positives, unlabeled
