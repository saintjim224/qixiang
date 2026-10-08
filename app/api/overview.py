"""
MeteoRiskPlatform - 态势总览与区域元数据路由
"""

from __future__ import annotations

import json
import time
from typing import Any
from fastapi import APIRouter, HTTPException

from app.core.dataio import load_region_list, get_region_meta, load_table
from app.algorithm.spi import calculate_spi
from app.algorithm.gdi import compute_gdi
from app.algorithm.disaster import fetch_open_meteo_forecast, predict_disasters
from app.algorithm.pu_model import predict_county_pu_risk
from app.algorithm.carrying import calculate_carrying_capacity
from app.core.config import BOUNDARIES_DIR, DATA_DIR, DATA_SOURCE_MODE
from app.core.branding import PRODUCT_NAME
from app.core.schemas import RegionMeta

router = APIRouter(prefix="/api/overview", tags=["态势总览"])

# 缓存 26 县风险综合评估，提升端侧秒级响应
_COUNTY_RISKS_CACHE: dict[str, Any] | None = None
_CACHE_TIMESTAMP: float = 0.0
_CACHE_TTL: float = 3600.0

# 草畜平衡指数的分子需要县域"实际牲畜量"。business_subjects 里按主体记录了
# cattle_count / sheep_count, 这里按 1 头牦牛 = 4 个羊单位折算成与载畜量同量纲的羊单位。
SHEEP_UNITS_PER_YAK = 4.0


def _actual_livestock_sheep_units() -> dict[str, float]:
    """汇总各县经营主体的实际存栏量 (羊单位)。"""
    totals: dict[str, float] = {}
    for s in load_table("business_subjects"):
        rid = str(s.get("region_id") or "")
        if not rid:
            continue
        units = float(s.get("cattle_count") or 0) * SHEEP_UNITS_PER_YAK + float(s.get("sheep_count") or 0)
        totals[rid] = totals.get(rid, 0.0) + units
    return totals


@router.get("/status")
def get_system_status() -> dict[str, Any]:
    """获取全域气象灾害监测系统运行状态与数据底座健康度."""
    regions = load_region_list()
    return {
        "system_name": PRODUCT_NAME,
        "data_source_mode": DATA_SOURCE_MODE,
        "monitored_regions_count": len(regions),
        "data_engines": {
            "era5_reanalysis": "已接入 26 县 6 年 (2020-2025) 5.7 万条逐日真实气象记录",
            "modis_ecological": "已接入 25 年 MOD17A3HGF NPP 与 22 年物候序列",
            "standards_embedded": "GB/T 20482-2006 牧区雪灾国家标准 & SPI-3 气象干旱指标",
            "grid_resolution": "2,080 时空网格微切片 (26县 × 4草场 × 4季节 × 5生理期)",
        },
        "status": "operational",
    }


@router.get("/regions", response_model=list[RegionMeta])
def list_monitored_regions() -> list[dict[str, Any]]:
    """获取 26 个典型县域清单及核心空间地理特征."""
    regions = load_region_list()
    results: list[dict[str, Any]] = []
    for r in regions:
        results.append({
            "region_id": r.get("region_id"),
            "name_cn": r.get("region_name") or r.get("name_cn") or r.get("name", ""),
            "province": r.get("province", ""),
            "prefecture": r.get("city") or r.get("prefecture", ""),
            "elevation": float(r.get("altitude") or r.get("elevation", 4000)),
            "latitude": float(r.get("latitude", 31.0)),
            "longitude": float(r.get("longitude", 90.0)),
            "pasture_type": r.get("pasture_type", "高寒草甸"),
        })
    return results


@router.get("/region/{region_id}")
def get_single_region_detail(region_id: str) -> dict[str, Any]:
    """获取单个县域详细档案."""
    meta = get_region_meta(region_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"县域未找到: {region_id}")
    return meta


@router.get("/geojson/{region_id}")
def get_region_geojson(region_id: str) -> dict[str, Any]:
    """获取单个县域的 GeoJSON 边界数据."""
    path = BOUNDARIES_DIR / f"{region_id}.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"GeoJSON 未找到: {region_id}")
    return json.loads(path.read_text(encoding="utf-8"))


_GEOJSON_ALL_CACHE: dict[str, Any] | None = None
_GEOJSON_COUNTIES_ONLY_CACHE: dict[str, Any] | None = None


@router.get("/geojson-all")
def get_all_regions_feature_collection(include_provinces: bool = True) -> dict[str, Any]:
    """
    合并 26 个县域与 4 大省区 (西藏、青海、四川、甘肃) 底图边界为规范的 FeatureCollection，供 ECharts 地图渲染.
    - include_provinces=True (默认): 提供宏观高原省界背景，消除黑底孤立浮岛感;
    - 4 大省界排在前面，26 个监测县排在后面以保持正确的图层层叠与交互优先级.
    """
    global _GEOJSON_ALL_CACHE, _GEOJSON_COUNTIES_ONLY_CACHE
    if include_provinces and _GEOJSON_ALL_CACHE is not None:
        return _GEOJSON_ALL_CACHE
    if not include_provinces and _GEOJSON_COUNTIES_ONLY_CACHE is not None:
        return _GEOJSON_COUNTIES_ONLY_CACHE

    county_features = []
    for r in load_region_list():
        rid = r.get("region_id")
        path = BOUNDARIES_DIR / f"{rid}.geojson"
        if path.exists():
            try:
                g = json.loads(path.read_text(encoding="utf-8"))
                # 边界文件顶层为 FeatureCollection，提取首个 Feature 的几何对象 MultiPolygon/Polygon
                if "features" in g and len(g["features"]) > 0:
                    geom = g["features"][0].get("geometry")
                else:
                    geom = g.get("geometry", g)

                r_name = r.get("region_name") or r.get("name_cn") or rid
                feat = {
                    "type": "Feature",
                    "properties": {
                        "name": r_name,
                        "region_id": rid,
                        "elevation": float(r.get("altitude") or r.get("elevation", 4000)),
                        "province": r.get("province", ""),
                        "is_province": False,
                    },
                    "geometry": geom,
                }
                county_features.append(feat)
            except Exception as e:
                print(f"[overview] 解析边界失败 {rid}: {e}")

    _GEOJSON_COUNTIES_ONLY_CACHE = {"type": "FeatureCollection", "features": county_features}

    # 加载 4 大省区底图 (西藏、青海、四川、甘肃)
    prov_features = []
    prov_file = DATA_DIR / "provinces_basemap.json"
    if prov_file.exists():
        try:
            prov_data = json.loads(prov_file.read_text(encoding="utf-8"))
            for pf in prov_data.get("features", []):
                p_props = pf.get("properties", {})
                feat = {
                    "type": "Feature",
                    "properties": {
                        "name": p_props.get("name", "省界底图"),
                        "adcode": p_props.get("adcode"),
                        "is_province": True,
                    },
                    "geometry": pf.get("geometry"),
                }
                prov_features.append(feat)
        except Exception as e:
            print(f"[overview] 加载省区底图失败: {e}")

    _GEOJSON_ALL_CACHE = {
        "type": "FeatureCollection",
        "features": prov_features + county_features,
    }
    return _GEOJSON_ALL_CACHE if include_provinces else _GEOJSON_COUNTIES_ONLY_CACHE


@router.get("/county-risks")
def get_county_risks_overview() -> dict[str, Any]:
    """
    全量 26 县气象灾害与生态综合风险评估及宏观汇总统计.
    供驾驶舱 26 县空间色阶地图、宏观卡片和县域联动真实动态绑定.
    """
    global _COUNTY_RISKS_CACHE, _CACHE_TIMESTAMP
    now = time.time()
    if _COUNTY_RISKS_CACHE and (now - _CACHE_TIMESTAMP < _CACHE_TTL):
        return _COUNTY_RISKS_CACHE

    regions = load_region_list()
    counties_data: list[dict[str, Any]] = []
    livestock_by_region = _actual_livestock_sheep_units()
    pu_sample_counts: dict[str, int] = {}
    for sample in load_table("real_labels_1500"):
        sample_region = sample.get("region_id")
        if sample_region:
            pu_sample_counts[sample_region] = pu_sample_counts.get(sample_region, 0) + 1
    carrying_scenario = {"target_year": 2025, "target_month": 12, "snow_cover_pct": 10.0}
    # 预先批量取回天气；逐县计算复用缓存，避免启动时串行发送 26 次外部请求。
    fetch_open_meteo_forecast([r["region_id"] for r in regions])

    snow_warning_count = 0
    drought_warning_count = 0
    carrying_ratios: list[float] = []
    # 本轮评估中有多少县真正拿到了 Open-Meteo 实时预报驱动。
    # 外网不可达时雪灾等级由气候态外推得到，属于参考量而非实时灾情，
    # 不能计入"预警中"县数，否则会凭空制造全域雪灾假象。
    realtime_counties = 0
    degraded_counties = 0

    for r in regions:
        rid = r.get("region_id", "")
        rname = r.get("region_name") or r.get("name_cn") or rid

        # 每项指标独立容错：缺哪一项就如实记 None 并把名字记进 unavailable_indices。
        #
        # 旧实现是 5 项指标一起 try，任一失败就 `continue` 丢掉整个县；而用的
        # 默认值又是 .get(key, 0.1)/.get(key, 30.0)/.get(key, 0.5) 这类**看起来
        # 正常**的数字，于是缺数据的县要么凭空消失、要么带着编造的分数留在图上。
        # 现在改为：县一定在，缺的那一项明确标 None。
        unavailable: list[str] = []

        def _attempt(label: str, fn):
            try:
                return fn()
            except Exception as e:  # 单项失败不牵连整县
                print(f"[overview] 县域 {rid} 的 {label} 计算失败: {e}")
                unavailable.append(label)
                return None

        s = _attempt("spi", lambda: calculate_spi(rid))
        g = _attempt("gdi", lambda: compute_gdi(rid))
        d = _attempt("disaster", lambda: predict_disasters(rid, days_ahead=16))
        p = _attempt("pu", lambda: predict_county_pu_risk(rid))
        # 退化等级必须显式传入: 该参数默认固定为"基本稳定", 不传等于 26 个县
        # 共用同一个退化惩罚系数, 县域之间的载畜量差异会被整体抹平。
        c = (
            _attempt(
                "carrying",
                lambda: calculate_carrying_capacity(
                    rid, degradation_level=str(g["degradation_level_cn"]), **carrying_scenario
                ),
            )
            if g is not None
            else None
        )

        spi_val = None if s is None else s.get("spi_value")
        drought_lvl = None if s is None else str(s.get("drought_level_gb") or s.get("drought_level") or "数据不足")
        if isinstance(spi_val, (int, float)) and spi_val <= -1.0:
            drought_warning_count += 1

        snow_dis = (d or {}).get("snow_disaster") or {}
        snow_depth = snow_dis.get("max_simulated_snow_depth_cm")
        snow_days = snow_dis.get("continuous_snow_days")
        snow_lvl = snow_dis.get("level_cn")
        snow_code = snow_dis.get("level_code")
        is_realtime = bool((d or {}).get("is_realtime", False)) if d is not None else None
        if d is not None:
            if is_realtime:
                realtime_counties += 1
            else:
                degraded_counties += 1
        # 只有实时驱动下的 III/IV 级才计为"预警中"
        if is_realtime and isinstance(snow_code, int) and snow_code >= 3:
            snow_warning_count += 1

        cold_wave = (d or {}).get("cold_wave") or {}
        min_temp = cold_wave.get("min_forecast_temp_c")

        # 卡片标题写的是"日均气温", 原实现却是 (预报最低气温 + 3.0) 的经验偏移。
        # 既不是日均温, 也与右侧同一页的 16 天曲线互相矛盾 (色尼区卡片 -4.1℃,
        # 而同页 D+1 曲线是 +6.8℃)。改用预报序列里真实存在的 D+1 日均气温,
        # 并把 16 天窗口均值一并回传, 供卡片副标题如实标注。
        temps_16 = [
            float(t)
            for t in ((d or {}).get("forecast_series", {}).get("temps_16") or [])
            if t is not None
        ]
        if temps_16:
            temp_d1 = round(temps_16[0], 1)
            temp_window_mean = round(sum(temps_16) / len(temps_16), 1)
        else:
            temp_d1 = temp_window_mean = None

        pu_prob = None if p is None else p.get("calibrated_risk_prob")
        pu_score = None if p is None else p.get("risk_score")

        gdi_val = None if g is None else g.get("gdi_value")
        gdi_lvl = None if g is None else g.get("degradation_level")

        # 草畜平衡指数 = 实际存栏(羊单位) / 精算载畜量(羊单位)。
        # 原实现读取的 actual_livestock 与 refined_carrying_capacity 两个键在
        # calculate_carrying_capacity 的返回值里都不存在 (返回的是
        # refined_carrying_capacity_sheep_unit, 也没有任何实际存栏字段), 两个 .get
        # 双双落到默认值 10000.0, 于是 26 个县的指数恒等于 1.00。
        capacity_su = (c or {}).get("refined_carrying_capacity_sheep_unit") or 0.0
        actual_su = livestock_by_region.get(rid)
        carrying_ratio = (
            round(actual_su / capacity_su, 2) if (actual_su and capacity_su > 0) else None
        )
        if carrying_ratio is not None:
            carrying_ratios.append(carrying_ratio)

        # 综合气象灾害风险分 (0-100 科学综合打分)
        # 权重: PU 概率(40%) + 积雪/低温风险(30%) + 干旱反向指数(15%) + 草地脆弱退化(15%)
        #
        # 四项输入缺任意一项即无法给出可比的综合分：此时返回 None（而不是拿默认值
        # 凑一个数），前端按"数据不足"呈现。混用不同输入基础算出的分数会让县与县
        # 之间失去可比性，比留空更有害。
        comp_risk = None
        risk_level_tag = "数据不足"
        if None not in (pu_score, snow_depth, spi_val, gdi_val) and snow_days is not None:
            snow_score = min(100.0, (snow_depth / 25.0) * 80.0 + (snow_days / 10.0) * 20.0)
            drought_score = max(0.0, min(100.0, (-spi_val + 1.0) * 35.0))
            comp_risk = round(
                0.40 * pu_score + 0.30 * snow_score
                + 0.15 * drought_score + 0.15 * (gdi_val * 100.0),
                1,
            )
            comp_risk = max(15.0, min(95.0, comp_risk))
            if comp_risk >= 75.0:
                risk_level_tag = "重特大预警"
            elif comp_risk >= 60.0:
                risk_level_tag = "高风险"
            elif comp_risk >= 40.0:
                risk_level_tag = "中度风险"
            else:
                risk_level_tag = "低风险"

        counties_data.append({
            "region_id": rid,
            "name_cn": rname,
            "province": r.get("province", ""),
            "elevation": float(r.get("altitude") or r.get("elevation") or 0) or None,
            "pasture_type": r.get("pasture_type") or None,
            "risk_score": comp_risk,
            "risk_level": risk_level_tag,
            "unavailable_indices": unavailable,
            "pu_sample_count": pu_sample_counts.get(rid, 0),
            "temp": temp_d1,
            "temp_window_mean": temp_window_mean,
            "temp_min": min_temp,
            "snow_depth": snow_depth,
            "continuous_snow_days": snow_days,
            "snow_level": snow_lvl,
            "snow_level_code": snow_code,
            "is_realtime": is_realtime,
            "data_source": (d or {}).get("data_source"),
            "provenance_note": (d or {}).get("provenance_note"),
            "drought_level": drought_lvl,
            "spi_value": None if spi_val is None else round(float(spi_val), 2),
            "gdi_value": None if gdi_val is None else round(float(gdi_val), 2),
            "degradation_level": gdi_lvl,
            "pu_prob": None if pu_prob is None else round(float(pu_prob), 3),
            "carrying_ratio": carrying_ratio,
            "carrying_scenario": carrying_scenario,
        })

    # 无可用县域时返回 None, 不再回落到 0.92 这种凭空捏造的"正常值"
    avg_carrying = (
        round(sum(carrying_ratios) / len(carrying_ratios), 2) if carrying_ratios else None
    )

    payload = {
        "counties": counties_data,
        "macro_stats": {
            "total_counties": len(counties_data),
            "snow_warning_count": snow_warning_count,
            "drought_warning_count": drought_warning_count,
            "avg_carrying_balance": avg_carrying,
            "carrying_scenario": carrying_scenario,
            # 数据口径披露：雪灾等级究竟由实时预报还是气候态外推得到
            "realtime_counties": realtime_counties,
            "degraded_counties": degraded_counties,
            "snow_data_mode": "realtime" if degraded_counties == 0 else ("climatological" if realtime_counties == 0 else "mixed"),
        },
        "is_derived": True,
    }
    _COUNTY_RISKS_CACHE = payload
    _CACHE_TIMESTAMP = now
    return payload
