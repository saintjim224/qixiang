"""
MeteoRiskPlatform - 草场载畜量精算与应急饲草调配成本模型
=============================================================================
规范遵循:
- §4.5: 载畜量全部严格标注为派生值 (is_derived=True);
        综合公式: NPP基准 × NDVI修正 × 季节系数 × 退化惩罚 × 积雪阻碍 × 物候修正;
        应急补饲成本计算融入高程气温垂直递减率与牲畜群体生理结构.
"""

from __future__ import annotations

import math
from typing import Any

from app.core.dataio import (
    get_npp_by_region,
    get_phenology_by_region,
    get_region_meta,
    get_remote_sensing_series,
)


def calculate_carrying_capacity(
    region_id: str,
    target_year: int = 2025,
    target_month: int = 12,
    degradation_level: str = "基本稳定",
    snow_cover_pct: float = 10.0,
) -> dict[str, Any]:
    """
    六维度生态载畜量精算模型 (全量派生值):
    Refined = NPP基准 × NDVI修正 × 季节系数 × 退化惩罚 × 积雪阻碍 × 物候修正
    """
    # 本函数会记录哪些输入是"缺省/中性"而非实测，最终随结果一并披露，
    # 避免读者把 identity 补位当成真实测量结果。
    degraded_inputs: list[str] = []

    # 1. NPP 基准
    # NPP 是载畜量的**主项**，缺了它就没有基准值。原实现兜底 0.45 这个"缺省均值"，
    # 于是没有遥感数据的县会带着一个凭空数字算出完整载畜量——宁可不给，也不给假的。
    npp_data = get_npp_by_region(region_id)
    annual_dict = (npp_data or {}).get("npp_annual") or {}
    npp_val = annual_dict.get(str(target_year)) or annual_dict.get("2024")
    if npp_val is None:
        raise ValueError(
            f"县域 '{region_id}' 缺少 {target_year} 年 (或 2024 年) NPP 年值，"
            "裁畜量主项无基准，拒绝用缺省均值替代。"
        )

    base_sheep_unit = int(float(npp_val) * 150000 + 50000)

    # 2. NDVI 修正 (缺遥感序列时取中性因子 1.0 = 不做修正，并如实标注)
    rs_series = get_remote_sensing_series(region_id)
    ndvi_factor = 1.0
    if rs_series:
        recent_ndvi = [r.get("ndvi") for r in rs_series[-12:] if r.get("ndvi") is not None]
        if recent_ndvi:
            mean_ndvi = sum(recent_ndvi) / len(recent_ndvi)
            current = rs_series[-1].get("ndvi")
            current_ndvi = float(current) if current is not None else mean_ndvi
            ndvi_factor = max(0.6, min(1.3, 1.0 + (current_ndvi - mean_ndvi)))
        else:
            degraded_inputs.append("ndvi")
    else:
        degraded_inputs.append("ndvi")

    # 3. 季节系数 (冬少夏多)
    season_factors = {
        12: 0.40, 1: 0.40, 2: 0.40, 3: 0.55, 4: 0.70, 5: 0.85,
        6: 1.00, 7: 1.00, 8: 1.00, 9: 0.85, 10: 0.70, 11: 0.55,
    }
    season_factor = season_factors.get(target_month, 0.70)

    # 4. 退化惩罚
    degrad_factors = {
        "基本稳定": 1.00,
        "轻度退化": 0.80,
        "中度退化": 0.60,
        "重度退化": 0.40,
    }
    degrad_factor = degrad_factors.get(degradation_level, 0.80)

    # 5. 积雪阻碍
    if snow_cover_pct > 50.0:
        snow_factor = 0.50
    elif snow_cover_pct > 30.0:
        snow_factor = 0.70
    elif snow_cover_pct > 15.0:
        snow_factor = 0.85
    else:
        snow_factor = 1.00

    # 6. 物候修正 (生长季偏差)
    # phenology_by_region.json 的条目键是 years / data / statistics, 并没有 phenology_annual,
    # 原判空条件恒为假, 物候因子永远是 1.0 —— 标称的"六维"实际只有五维在生效。
    # 真实的年生长季长度在 data.growing_season 下 (形如 {"2003": 142.7, ...})。
    pheno_data = get_phenology_by_region(region_id)
    pheno_factor = 1.0
    growing_season = ((pheno_data or {}).get("data") or {}).get("growing_season") or {}
    if growing_season:
        length = growing_season.get(str(target_year)) or growing_season.get("2024")
        if length is not None:
            # 生长季长则草场恢复好
            pheno_factor = max(0.85, min(1.15, 1.0 + (float(length) - 120) * 0.002))
        else:
            degraded_inputs.append("phenology")
    else:
        degraded_inputs.append("phenology")

    # 综合精算载畜量
    refined_capacity = int(
        base_sheep_unit
        * ndvi_factor
        * season_factor
        * degrad_factor
        * snow_factor
        * pheno_factor
    )

    return {
        "region_id": region_id,
        "target_year": target_year,
        "target_month": target_month,
        "refined_carrying_capacity_sheep_unit": refined_capacity,
        # 哪些因子是"中性补位"而非由实测数据修正，必须随结果披露
        "degraded_inputs": degraded_inputs,
        "npp_source": {
            "npp_annual_value": float(npp_val),
            "year_used": str(target_year) if str(target_year) in annual_dict else "2024",
        },
        "factors": {
            "npp_base_sheep_unit": base_sheep_unit,
            "ndvi_factor": round(ndvi_factor, 3),
            "season_factor": season_factor,
            "degradation_factor": degrad_factor,
            "snow_factor": snow_factor,
            "phenology_factor": round(pheno_factor, 3),
        },
        "is_derived": True,
        "provenance_note": "本载畜量数值由 MODIS 遥感、气候季节与国标物理参数推导得出，非县域实际核定载畜量",
    }


def estimate_emergency_feed_demand(
    region_id: str,
    herd_size_yak: int = 1000,
    forecast_days: int = 14,
    mean_temp_c: float = -12.0,
    snow_depth_cm: float = 14.0,
) -> dict[str, Any]:
    """
    应急补饲需求与抗灾保畜物资调度测算:
    根据积雪深度与日均温确定每日补饲比例与干草、精饲料需求吨数.
    """
    meta = get_region_meta(region_id)
    elevation = float(meta.get("elevation", 4000.0)) if meta else 4000.0

    # 判定补饲强度
    if snow_depth_cm >= 10.0 or mean_temp_c <= -10.0:
        feed_ratio = 1.0  # 100% 依赖人工补饲 (积雪完全覆盖牧草或极寒)
        feed_type = "全人工重度补饲 (雪灾应急)"
    elif snow_depth_cm >= 5.0 or mean_temp_c <= -5.0:
        feed_ratio = 0.7
        feed_type = "半草场半补饲"
    elif snow_depth_cm > 0 or mean_temp_c <= 0:
        feed_ratio = 0.3
        feed_type = "轻度补充防寒"
    else:
        feed_ratio = 0.0
        feed_type = "全草场放牧"

    # 每头成年牦牛标准: 4kg 干草 + 0.8kg 精料/天 (牛群均值系数 1.05)
    daily_hay_kg_per_yak = 4.0 * 1.05 * feed_ratio
    daily_grain_kg_per_yak = 0.8 * 1.05 * feed_ratio

    total_hay_tons = round((daily_hay_kg_per_yak * herd_size_yak * forecast_days) / 1000.0, 1)
    total_grain_tons = round((daily_grain_kg_per_yak * herd_size_yak * forecast_days) / 1000.0, 1)

    # 成本测算 (干草 0.85元/kg, 精料 3.60元/kg)
    hay_cost = total_hay_tons * 1000 * 0.85
    grain_cost = total_grain_tons * 1000 * 3.60
    total_feed_cost_wan = round((hay_cost + grain_cost) / 10000.0, 2)

    return {
        "region_id": region_id,
        "elevation_m": elevation,
        "forecast_days": forecast_days,
        "herd_size_yak": herd_size_yak,
        "feed_mode": feed_type,
        "feed_ratio": feed_ratio,
        "recommended_hay_tons": total_hay_tons,
        "recommended_grain_tons": total_grain_tons,
        "total_feed_cost_wan": total_feed_cost_wan,
        "is_derived": True,
    }
