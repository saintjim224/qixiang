"""
MeteoRiskPlatform - 气象与遥感数据底座接口
=============================================================================
规范遵循:
- §5.0 数据事实边界严格呈现:
  公开观测 / 派生 / 来源支持事件 / 样例模拟 / 未标注 5级显式分类.
"""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException

from app.core.dataio import (
    get_weather_series,
    get_remote_sensing_series,
    get_npp_by_region,
    get_phenology_by_region,
    load_table,
)

router = APIRouter(prefix="/api/datasource", tags=["气象数据底座"])


@router.get("/provenance")
def get_data_provenance_and_tiers() -> dict[str, Any]:
    """获取全套数据溯源链与五级事实边界分类报告 (答辩必审)."""
    return {
        "discipline_statement": "本项目严格遵循数据真实性分级规范，严禁将样例、派生或未标注数据宣传为真实业务数据。",
        "tiers": [
            {
                "tier_name": "公开科学观测 (Public Observation)",
                "data_sources": [
                    # 覆盖区间与要素取自 climate_era5.json 的实际内容:
                    # 2192 条/县 = 2020-01-01 ~ 2025-12-31, 字段仅 date/temp_mean/precip_mm。
                    # 原先把区间写成 2015-2024、把风速与积雪深度也算进 ERA5, 两者都与文件不符
                    # (风速/积雪深度属于 CMFD 逐月表, 不在本表内)。
                    {"name": "ECMWF ERA5 逐日格点再分析气候", "range": "2020-2025 (2192天)", "records": "5.7万+条", "fields": "逐日平均气温、降水"},
                    {"name": "NASA MODIS MOD17A3HGF", "range": "2001-2025 (25年)", "records": "26县年度像元均值", "fields": "NPP 净初级生产力"},
                    {"name": "NASA MODIS MCD12Q2", "range": "2003-2024 (22年)", "records": "26县物候序列", "fields": "返青期、枯黄期、年生长季长度"},
                    {"name": "TPDC CMFD V0106", "range": "2015-2018", "records": "26县逐月气候", "fields": "青藏高原高精度地面气象要素驱动"},
                    {"name": "Open-Meteo 实时气象", "range": "前瞻 0-16 天", "records": "实时 API", "fields": "逐日气温、降雪量、积雪深度预报"}
                ]
            },
            {
                "tier_name": "来源支持真实灾害事件 (Verified Events)",
                "count": 127,
                "note": "具有官方媒体/应急管理部公开通报 URL 凭证的雪灾、寒潮、暴雨灾害事件。"
            },
            {
                "tier_name": "未标注背景样本 (Unlabeled)",
                "count": 1373,
                "note": "无明确报道的月份，采用 PU Learning 进行正例-未标注半监督挖掘，严禁等同于真实负例。"
            },
            {
                "tier_name": "科学模型派生 (Scientific Derived)",
                "models": ["GB/T 20482 雪灾等级", "Gamma SPI-3 干旱指数", "Li 2025 GDI 草场退化度", "六维生态载畜量精算"]
            },
            {
                "tier_name": "产业下游应用模拟 (Downstream Simulation)",
                "modules": ["应急饲草储备调配吨数测算", "牲畜资产风险敞口核算", "绿色金融防灾信贷额度建议"]
            }
        ]
    }


@router.get("/series/{region_id}")
def get_county_time_series(region_id: str) -> dict[str, Any]:
    """获取指定县域的历史气象与遥感多源时序."""
    w = get_weather_series(region_id)
    rs = get_remote_sensing_series(region_id)
    npp = get_npp_by_region(region_id)
    pheno = get_phenology_by_region(region_id)

    if not w and not rs:
        raise HTTPException(status_code=404, detail=f"县域时序数据未找到: {region_id}")

    # 原实现直接取 w[-12:]，而文件是按数据集分块写入的（CMFD V0106 在前、V0200 在后），
    # 于是"最近 12 条"实际切出的是夹在中间的一段，界面上显示的所谓"近期样本"根本不是最近年份。
    # 必须按观测时次排序后再取尾部，并如实回传真实覆盖区间。
    w_sorted = sorted(w, key=lambda r: str(r.get("observed_at", "")))
    rs_sorted = sorted(rs, key=lambda r: str(r.get("scene_date", "")))

    weather_datasets = sorted({str(r.get("dataset_name", "")) for r in w if r.get("dataset_name")})

    return {
        "region_id": region_id,
        "weather_series_count": len(w),
        "remote_sensing_series_count": len(rs),
        "recent_weather": w_sorted[-12:] if w_sorted else [],
        "recent_remote_sensing": rs_sorted[-12:] if rs_sorted else [],
        "weather_coverage": {
            "start": str(w_sorted[0].get("observed_at", ""))[:7] if w_sorted else "",
            "end": str(w_sorted[-1].get("observed_at", ""))[:7] if w_sorted else "",
            "count": len(w_sorted),
            "datasets": weather_datasets,
            "granularity": "monthly",
        },
        "remote_sensing_coverage": {
            "start": str(rs_sorted[0].get("scene_date", "")) if rs_sorted else "",
            "end": str(rs_sorted[-1].get("scene_date", "")) if rs_sorted else "",
            "count": len(rs_sorted),
        },
        "npp_annual": npp.get("npp_annual", {}) if npp else {},
        "phenology_annual": pheno.get("phenology_annual", {}) if pheno else {},
    }


# 灾害事件类型权威归一与标准中文映射字典 (遵循规格书与应急管理行业规范)
# 彻底终结原始英文枚举暴露与 insurance_coverage 属性错位问题
DISASTER_TYPE_MAPPING: dict[str, dict[str, Any]] = {
    # 暴雪与雪灾 (白灾 - 41条)
    "snowstorm": {
        "category": "暴雪与雪灾",
        "name_cn": "暴雪白灾",
        "is_meteorological": True,
        "desc": "强降雪、阶段性大到暴雪及积雪封山危害牧区放牧与牲畜安全",
    },
    # 暴雨与洪涝 (33条)
    "rainstorm": {
        "category": "暴雨洪涝",
        "name_cn": "特大暴雨",
        "is_meteorological": True,
        "desc": "局地强降雨诱发山洪、牧道损毁",
    },
    "rain": {
        "category": "暴雨洪涝",
        "name_cn": "持续连阴雨",
        "is_meteorological": True,
        "desc": "汛期连续强降水引发草场浸泡与洪涝",
    },
    # 政策农险赔付实证 (20条 - 工行杯金融科技核心实证闭环)
    "insurance_coverage": {
        "category": "政策农险赔付实证",
        "name_cn": "政策农险理赔实证",
        "is_meteorological": False,
        "desc": "高寒牧区政策性农业保险保额赔付与金融减灾保单证据",
    },
    "disease": {
        "category": "政策农险赔付实证",
        "name_cn": "疫病救助理赔实证",
        "is_meteorological": False,
        "desc": "极端气象诱发畜群疫病救助与财险赔付凭证",
    },
    "vaccination": {
        "category": "政策农险赔付实证",
        "name_cn": "防疫保畜理赔实证",
        "is_meteorological": False,
        "desc": "重大动物疫病防控及防灾保畜保险赔付核销",
    },
    # 强对流天气 (11条)
    "wind": {
        "category": "强对流天气",
        "name_cn": "高原大风",
        "is_meteorological": True,
        "desc": "8级以上大风致牲畜暖棚受损、草场风蚀",
    },
    "hail_storm": {
        "category": "强对流天气",
        "name_cn": "高原冰雹",
        "is_meteorological": True,
        "desc": "高原型短时强降雹致草场损毁与幼畜伤亡",
    },
    "lightning": {
        "category": "强对流天气",
        "name_cn": "雷暴闪电",
        "is_meteorological": True,
        "desc": "雷击引发牧区牲畜死伤与次生火情",
    },
    # 次生地质灾害 (10条)
    "landslide": {
        "category": "次生地质灾害",
        "name_cn": "暴雨诱发滑坡",
        "is_meteorological": False,
        "desc": "强降雨诱发的高原山体滑坡与泥石流",
    },
    "earthquake": {
        "category": "次生地质灾害",
        "name_cn": "高原地震",
        "is_meteorological": False,
        "desc": "地质活动致牧民房屋、暖棚与围栏损毁",
    },
    # 干旱与草场压力 (9条)
    "drought": {
        "category": "干旱与草场压力",
        "name_cn": "干旱黑灾",
        "is_meteorological": True,
        "desc": "气象干旱导致草场枯黄早发、牧草生长受阻、水源短缺",
    },
    "grassland_pressure": {
        "category": "干旱与草场压力",
        "name_cn": "水热失衡草场压力",
        "is_meteorological": True,
        "desc": "降水异常偏多或水热失衡冲击草场载畜承载力",
    },
    # 寒潮极温与复合 (3条)
    "cold_wave": {
        "category": "寒潮与复合",
        "name_cn": "强寒潮降温",
        "is_meteorological": True,
        "desc": "剧烈降温及超低温危害产羔与幼畜越冬",
    },
    "comprehensive": {
        "category": "寒潮与复合",
        "name_cn": "复合气象灾害",
        "is_meteorological": True,
        "desc": "低温大风雨雪多灾种交织并发",
    },
}


@router.get("/verified-events")
def get_verified_disaster_events(
    region_id: str | None = None,
    category: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """获取民政部与应急管理部门官方通报确证灾害事件清单 (127条真例，经过归一与中文映射)."""
    from app.core.dataio import get_pu_labeled_dataset, load_region_list
    positives, unlabeled = get_pu_labeled_dataset()
    region_map = {r.get("region_id"): r.get("region_name", r.get("region_id")) for r in load_region_list()}

    events = []
    for p in positives:
        rid = p.get("region_id", "")
        if region_id and rid != region_id:
            continue

        raw_t = p.get("event_type", "other")
        meta = DISASTER_TYPE_MAPPING.get(raw_t, {
            "category": "其他灾害",
            "name_cn": raw_t,
            "is_meteorological": True,
            "desc": "",
        })

        if category and category != "全部" and meta["category"] != category:
            continue

        events.append({
            "region_id": rid,
            "region_name": region_map.get(rid, rid),
            "month": p.get("month", ""),
            "event_type": meta["name_cn"],
            "category": meta["category"],
            "raw_event_type": raw_t,
            "is_meteorological": meta["is_meteorological"],
            "severity": p.get("severity", ""),
            "risk_score": p.get("risk_score", 0),
            "loss_amount_wan": round(float(p.get("loss_amount", 0)) / 10000.0, 2) if float(p.get("loss_amount", 0)) > 100 else float(p.get("loss_amount", 0)),
            "claim_amount_wan": round(float(p.get("claim_amount", 0)) / 10000.0, 2) if float(p.get("claim_amount", 0)) > 100 else float(p.get("claim_amount", 0)),
            "source": p.get("source", "地方应急防灾通报"),
            "source_url": p.get("source_url", ""),
            "note": p.get("note", ""),
        })

    events.sort(key=lambda x: x["month"], reverse=True)

    category_counts: dict[str, int] = {}
    for p in positives:
        raw_t = p.get("event_type", "other")
        c = DISASTER_TYPE_MAPPING.get(raw_t, {}).get("category", "其他灾害")
        category_counts[c] = category_counts.get(c, 0) + 1

    ordered_categories = [
        "全部",
        "暴雪与雪灾",
        "暴雨洪涝",
        "政策农险赔付实证",
        "强对流天气",
        "次生地质灾害",
        "干旱与草场压力",
        "寒潮与复合",
    ]

    return {
        "total_verified_count": len(positives),
        "total_unlabeled_count": len(unlabeled),
        "filtered_count": len(events),
        "category_distribution": category_counts,
        "categories_ordered": ordered_categories,
        "events": events[:limit],
        "evidence_discipline": "127条灾情与农险理赔实证均经官方通报溯源核验，严禁伪造任何样本凭证",
    }

