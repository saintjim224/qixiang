"""
MeteoRiskPlatform - 气象风险指数路由 (SPI, GDI, 四维时空网格)
=============================================================================
规范遵循:
- §4.1: 标准 Gamma SPI 与旧版简化 SPI 对照输出
- §4.2: 论文复现 GDI 与旧版简化 GDI 对照输出
- 2,080 时空网格切片矩阵
"""

from __future__ import annotations

import time
from typing import Any
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/index", tags=["气象风险指数"])


def _unavailable(endpoint: str, region_id: str, exc: Exception) -> JSONResponse:
    """
    计算失败时的**唯一**返回方式：如实报告不可用，一律 503。

    规格书 §6 红线禁止以编造数值冒充真实结果。旧实现在此处的 except 分支里返回
    SPI 0.42 / GDI 0.58 / PU 0.28 等写死的"正常"数值，前端拿到后无从分辨真伪，
    等于伪造了一份看起来健康的风险评估——已全部移除，改为显式失败。
    """
    return JSONResponse(
        status_code=503,
        content={
            "status": "unavailable",
            "endpoint": endpoint,
            "region_id": region_id,
            "reason": f"{type(exc).__name__}: {exc}",
            "note": "本接口不做数值兜底：计算失败即如实返回 503，不提供任何估算值。",
        },
    )

# 全域 26 县方法对照结果缓存 (SPI/GDI 逐县计算较慢，TTL 内复用)
_METHOD_COMPARE_CACHE: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}
_METHOD_COMPARE_TTL: float = 3600.0

def _spi_class(value: float | None) -> str | None:
    """
    按 SPI 标准分位区间归一化干旱等级 (消除新旧算法命名差异)。

    原实现本地维护了一张分档表，其中 **漏掉了 "轻旱" 档**：SPI=-0.7 这类明确
    轻旱的值会一路落到 <1.0 分支被判成 "正常"，使新旧算法对照的 level_changed
    统计系统性偏低。现统一引用 spi 模块的 GB/T 20481-2017 分档表。
    """
    from app.algorithm.spi import classify_spi_gb

    return classify_spi_gb(value)


def _gdi_class(value: float | None, thresholds: dict[str, float] | None) -> str | None:
    """按 Li et al. (2025) 曲率阈值归一化退化等级."""
    if value is None or not thresholds:
        return None
    if value < thresholds["theta1_stable_light"]:
        return "基本稳定"
    if value < thresholds["theta2_light_moderate"]:
        return "轻度退化"
    if value < thresholds["theta3_moderate_severe"]:
        return "中度退化"
    return "重度退化"


@router.get("/spi/{region_id}")
def get_spi_index(
    region_id: str,
    scale: int = Query(3, ge=1, le=12, description="时间尺度 (月)"),
    month: str | None = Query(None, description="目标月份 (YYYY-MM)"),
) -> Any:
    """获取指定县域标准 Gamma 拟合 SPI 及与旧版 Z-score 的对比."""
    try:
        from app.algorithm.spi import calculate_spi
        return calculate_spi(region_id=region_id, scale=scale, target_month=month)
    except Exception as e:
        return _unavailable("spi", region_id, e)


@router.get("/gdi/{region_id}")
def get_gdi_index(
    region_id: str,
    year: int = Query(2024, ge=2001, le=2025, description="目标年份"),
) -> Any:
    """获取指定县域论文级 PCA+Kmeans GDI 草场退化指数及与旧版对比."""
    try:
        from app.algorithm.gdi import compute_gdi
        return compute_gdi(region_id=region_id, target_year=year)
    except Exception as e:
        return _unavailable("gdi", region_id, e)


@router.get("/method-compare")
def get_method_compare(
    scale: int = Query(3, ge=1, le=12, description="SPI 时间尺度 (月)"),
    year: int = Query(2024, ge=2001, le=2025, description="GDI 目标年份"),
) -> dict[str, Any]:
    """
    全域 26 县「新算法 vs 旧简化实现」逐县对照，用于举证算法修正的真实影响范围。

    输出每县的 SPI / GDI 新旧取值，并在**统一阈值标尺**下统计等级重判县数——
    新旧算法的等级命名口径不同（如 "轻旱" vs "轻度干旱"），直接比字符串会
    把纯命名差异误报成结论差异，故此处统一换算后再比较。
    """
    now = time.time()
    cache_key = (scale, year)
    cached = _METHOD_COMPARE_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _METHOD_COMPARE_TTL:
        return cached[1]

    from app.algorithm.spi import calculate_spi
    from app.algorithm.gdi import compute_gdi
    from app.core.dataio import load_region_list

    counties: list[dict[str, Any]] = []
    gdi_thresholds: dict[str, float] | None = None
    for region in load_region_list():
        rid = region.get("region_id")
        if not rid:
            continue
        item: dict[str, Any] = {
            "region_id": rid,
            "region_name": region.get("region_name") or rid,
            "pasture_type": region.get("pasture_type", ""),
        }
        try:
            spi = calculate_spi(region_id=rid, scale=scale)
            item["spi_new"] = spi.get("spi_value")
            item["spi_old"] = spi.get("legacy_spi_value")
            item["spi_samples"] = spi.get("historical_years_count")
            item["spi_alpha"] = (spi.get("params") or {}).get("alpha")
        except Exception as exc:  # 单县失败不阻断全域对照
            item["spi_error"] = str(exc)
        try:
            gdi = compute_gdi(region_id=rid, target_year=year)
            item["gdi_new"] = gdi.get("gdi_value")
            item["gdi_old"] = gdi.get("legacy_gdi_value")
            gdi_thresholds = gdi.get("thresholds") or gdi_thresholds
        except Exception as exc:
            item["gdi_error"] = str(exc)

        item["spi_class_new"] = _spi_class(item.get("spi_new"))
        item["spi_class_old"] = _spi_class(item.get("spi_old"))
        counties.append(item)

    for item in counties:
        item["gdi_class_new"] = _gdi_class(item.get("gdi_new"), gdi_thresholds)
        item["gdi_class_old"] = _gdi_class(item.get("gdi_old"), gdi_thresholds)

    def _summarise(new_key: str, old_key: str, class_new: str, class_old: str) -> dict[str, Any]:
        deltas = [
            abs(c[new_key] - c[old_key])
            for c in counties
            if c.get(new_key) is not None and c.get(old_key) is not None
        ]
        comparable = [c for c in counties if c.get(class_new) and c.get(class_old)]
        return {
            "available_counties": len(deltas),
            "mean_abs_delta": round(sum(deltas) / len(deltas), 4) if deltas else None,
            "max_abs_delta": round(max(deltas), 4) if deltas else None,
            "min_abs_delta": round(min(deltas), 4) if deltas else None,
            "level_changed": sum(1 for c in comparable if c[class_new] != c[class_old]),
            "level_unchanged": sum(1 for c in comparable if c[class_new] == c[class_old]),
            "compared_counties": len(comparable),
        }

    payload = {
        "scale": scale,
        "target_year": year,
        "ruler": "统一阈值标尺 (SPI: ±1.0/1.5/2.0 · GDI: Li et al. 2025 曲率阈值)",
        "counties": counties,
        "spi_summary": _summarise("spi_new", "spi_old", "spi_class_new", "spi_class_old"),
        "gdi_summary": _summarise("gdi_new", "gdi_old", "gdi_class_new", "gdi_class_old"),
        "thresholds": {
            "spi": {"moderate_drought": -1.0, "severe_drought": -1.5, "extreme_drought": -2.0},
            "gdi": {
                "stable_light": gdi_thresholds["theta1_stable_light"],
                "light_moderate": gdi_thresholds["theta2_light_moderate"],
                "moderate_severe": gdi_thresholds["theta3_moderate_severe"],
            } if gdi_thresholds else None,
        },
        "is_derived": True,
    }
    _METHOD_COMPARE_CACHE[cache_key] = (now, payload)
    return payload


@router.get("/spatio-temporal-grid/{region_id}")
def get_spatio_temporal_grid(
    region_id: str,
    age_group: str = Query("all", description="生理期: all, calf, yearling, adult, old"),
) -> Any:
    """
    获取该县「真实草场类型 × 真实季节 × 生理群」气象风险微网格。

    每个分值由该县自己的 10 年逐月观测统计而来，县与县之间、季节与季节之间
    均有真实差异；组合权重在 method 字段原文披露，可逐项复算。
    """
    from app.algorithm.vulnerability_grid import compute_vulnerability_grid
    from app.core.dataio import load_region_list

    # 该县真实 GDI 作为「草场退化 → 承灾脆弱性」的输入；取不到时按 None 传入，
    # 由模块退化为仅用草场类型与生理群系数，并在结果中如实体现，绝不填假数。
    gdi_value: float | None = None
    try:
        from app.algorithm.gdi import compute_gdi
        gdi_value = (compute_gdi(region_id=region_id) or {}).get("gdi_value")
    except Exception:
        gdi_value = None

    try:
        payload = compute_vulnerability_grid(
            region_id=region_id, age_group=age_group, gdi_value=gdi_value
        )
    except Exception as e:
        return _unavailable("spatio-temporal-grid", region_id, e)

    if payload.get("status") != "ok":
        return JSONResponse(status_code=503, content=payload)

    # 全域网格数由真实县数 × 每县格数实时计算，不再写死
    county_count = len(load_region_list())
    payload["domain_county_count"] = county_count
    payload["total_grids_count"] = payload["county_micro_grids_count"] * county_count
    return payload


@router.get("/pu/{region_id}")
def get_pu_risk(
    region_id: str,
    month: str | None = Query(None, description="目标月份 (YYYY-MM)"),
) -> Any:
    """
    获取指定县域基于 PU Learning (正例-未标注学习) 的灾害风险评估与 SHAP 特征边际归因:
    - 使用已标注来源记录与未标注背景样本，标签仍待人工核验;
    - 输出代理标签校准评分、风险分级与 SHAP 解释，不能视作当前灾情或真实概率.
    """
    try:
        from app.algorithm.pu_model import predict_county_pu_risk
        return predict_county_pu_risk(region_id=region_id, month=month)
    except Exception as e:
        return _unavailable("pu", region_id, e)


@router.get("/pu-benchmark")
def get_pu_benchmark() -> dict[str, Any]:
    """返回先划分后训练的末年留出诊断及完整划分信息。"""
    from app.algorithm.pu_evaluation import run_pu_evaluation
    report = run_pu_evaluation()
    evaluation = report["evaluation"]
    ours = report["benchmark_results"]["Model 3 (PU Learning Model)"]
    report["provenance"] = "带来源的已标注事件与未标注背景；标签真实性仍需复核"
    report["key_findings"] = [
        f"{evaluation['name']}：训练 {evaluation['train_count']} 条，验证 {evaluation['test_count']} 条；样本不重叠。",
        f"已标注事件召回率 {ours['labeled_positive_recall']:.1%}；未标注样本告警率 {ours['unlabeled_alert_rate']:.1%}。",
        "F1、精确率和 Brier 仅对记录标签计算；未标注不等于无灾，不能把这些诊断值作为真实灾害识别指标。",
    ]
    return report
