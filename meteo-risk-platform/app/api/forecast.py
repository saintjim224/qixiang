"""
MeteoRiskPlatform - 多灾种预测与生态载畜预测路由
"""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Query

from app.algorithm.disaster import predict_disasters
from app.algorithm.carrying import calculate_carrying_capacity
from app.algorithm.yield_forecast import (
    predict_single_county_npp,
    evaluate_loyo_protocol,
    evaluate_loro_protocol,
    load_npp_features_dataset,
)

router = APIRouter(prefix="/api/forecast", tags=["灾害预测与生态载畜"])


@router.get("/disaster/{region_id}")
def get_disaster_forecast(region_id: str, days: int = Query(16, ge=1, le=90)) -> dict[str, Any]:
    """
    获取指定县域多尺度灾害预测:
    - 0-16天: 实时 Open-Meteo 降雪/极温驱动;
    - 17-90天: ERA5 气候态外推 (显式标注置信层级).
    """
    return predict_disasters(region_id, days_ahead=days)


@router.get("/carrying-capacity/{region_id}")
def get_carrying_capacity_forecast(
    region_id: str,
    year: int = 2025,
    month: int = 12,
    degradation_level: str = "基本稳定",
    snow_cover: float = 15.0,
) -> dict[str, Any]:
    """
    获取基于六维生态因子的精算载畜量:
    Refined = NPP基准 × NDVI修正 × 季节 × 退化 × 积雪 × 物候 (全量标注 is_derived=True).
    """
    return calculate_carrying_capacity(
        region_id=region_id,
        target_year=year,
        target_month=month,
        degradation_level=degradation_level,
        snow_cover_pct=snow_cover,
    )


@router.get("/npp/{region_id}")
def get_npp_forecast(
    region_id: str,
    year: int = Query(2026, ge=2001, le=2030, description="预测目标年份"),
    spi_override: float | None = Query(None, description="干旱情景注入: SPI 异常值"),
    temp_anomaly: float | None = Query(None, description="极端温变情景注入: 气温异常偏差 (°C)"),
) -> dict[str, Any]:
    """
    获取指定县域草地净初级生产力 (NPP) 智能时空预测与基线对照:
    - 融合 MOD17A3HGF 25年时序与 CMFD/ERA5 气象驱动;
    - 给出 95% 预测置信区间与三条经典基线对比.
    """
    return predict_single_county_npp(
        region_id=region_id,
        target_year=year,
        spi_override=spi_override,
        temp_anomaly_override=temp_anomaly,
    )


@router.get("/npp-benchmark")
def get_npp_benchmark_report() -> dict[str, Any]:
    """
    获取规格书 §4.4 标准双向留一交叉验证 (LOYO & LORO) 硬核科学指标对照表:
    - 协议 A: 留一年交叉验证 (LOYO) 25 轮外推;
    - 协议 B: 留一县交叉验证 (LORO) 26 轮空间迁移;
    - 包含 MAE、RMSE、R² 及相对三条基线的相对误差降低幅度 (%).
    """
    df = load_npp_features_dataset()
    loyo_summary = evaluate_loyo_protocol(df)
    loro_summary = evaluate_loro_protocol(df)
    return {
        "loyo_protocol": loyo_summary,
        "loro_protocol": loro_summary,
        "scientific_provenance": "MOD17A3HGF (2001-2025) 26县×25年=650样本 + CMFD 2.0 / ERA5",
        "uncertainty_note": "所报置信区间为实测折叠标准误的 95% 置信度 (mean ± 1.96*SE)",
    }
