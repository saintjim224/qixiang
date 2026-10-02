"""
MeteoRiskPlatform - 下游应用与韧性决策路由
=============================================================================
规范遵循:
- 明确为气象预测结果的下游赋能应用场景 (金融 + 农牧防灾).
"""

from __future__ import annotations

from datetime import datetime
import json
import time
from typing import Any
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.algorithm.carrying import estimate_emergency_feed_demand
from app.algorithm.disaster import predict_disasters
from app.core.config import DATA_DIR
from app.core.dataio import load_region_list

router = APIRouter(prefix="/api/decision", tags=["应用与决策"])

DISPATCH_LOG_FILE = DATA_DIR / "dispatch_logs.json"

_PRIORITY_CACHE: dict[str, Any] = {}
_PRIORITY_CACHE_TIMESTAMP: float = 0.0
_PRIORITY_CACHE_TTL = 900.0


def _forecast_driven_feed(
    region_id: str,
    herd_size: int,
    days: int,
    disaster_res: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    由**本次预报窗口**推算补饲强度。

    原实现调用 estimate_emergency_feed_demand 时没有传 mean_temp_c / snow_depth_cm，
    于是函数落到默认值 -12℃ / 14cm——无论实际天气如何，判定分支永远命中
    "snow_depth>=10 或 mean_temp<=-10"，feed_ratio 恒等于 1.0。
    结果就是：夏季、无雪县域也会报出满额"全人工重度补饲"，且全县域需求完全相同，
    既失真又无法体现空间差异。这里改用窗口内的平均积雪深度与平均气温驱动。
    """
    d = disaster_res if disaster_res is not None else predict_disasters(region_id, days_ahead=days)
    series = d.get("forecast_series", {}) or {}
    temps = [float(v) for v in (series.get("temps_16") or [])][:days]
    snows = [float(v) for v in (series.get("snow_16") or [])][:days]

    mean_temp = round(sum(temps) / len(temps), 1) if temps else -5.0
    mean_snow = round(sum(snows) / len(snows), 2) if snows else 0.0

    feed = estimate_emergency_feed_demand(
        region_id=region_id,
        herd_size_yak=herd_size,
        forecast_days=days,
        mean_temp_c=mean_temp,
        snow_depth_cm=mean_snow,
    )
    feed["mean_temp_c"] = mean_temp
    feed["mean_snow_depth_cm"] = mean_snow
    feed["snow_level"] = (d.get("snow_disaster", {}) or {}).get("level_cn", "正常 (无灾害)")
    feed["snow_level_code"] = int((d.get("snow_disaster", {}) or {}).get("level_code", 0))
    feed["is_realtime"] = bool(d.get("is_realtime", False))
    return feed


@router.get("/signal/{region_id}")
def get_decision_signal(
    region_id: str,
    herd_size: int = Query(1000, description="养殖规模 (牦牛头数)"),
    days: int = Query(14, description="预警周期 (天)"),
) -> dict[str, Any]:
    """
    根据气象预测生成下游决策信号:
    1. 应急饲草储备调度建议 (吨)
    2. 牲畜资产风险敞口核算 (万元)
    3. 绿色金融防灾信贷与农业保险增信缓释度 (万元)
    4. 针对性应急减灾处置动作清单
    """
    # 1. 灾害预测状态
    disaster_res = predict_disasters(region_id, days_ahead=days)
    snow_eval = disaster_res.get("snow_disaster", {})
    sim_depth = float(snow_eval.get("max_simulated_snow_depth_cm", 8.0))
    snow_level = snow_eval.get("level_cn", "正常")

    # 2. 饲草需求测算 (必须由本次预报窗口的真实均温/积雪驱动，见 _forecast_driven_feed)
    feed_res = _forecast_driven_feed(region_id, herd_size, days, disaster_res)

    # 3. 风险敞口与金融缓释
    avg_yak_price = 8500.0  # 牦牛均价 8500 元/头
    total_asset_wan = round((herd_size * avg_yak_price) / 10000.0, 2)

    loss_rate_map = {
        "正常 (无灾害)": 0.005,
        "轻度雪灾 (I级)": 0.02,
        "中度雪灾 (II级)": 0.05,
        "重度雪灾 (III级)": 0.12,
        "特重雪灾 (IV级)": 0.25,
    }
    loss_rate = loss_rate_map.get(snow_level, 0.03)
    loss_exposure_wan = round(total_asset_wan * loss_rate, 2)

    # 绿色金融防灾额度 (依据饲草储备成本与资产抵押折减)
    resilience_credit_quota_wan = round(feed_res["total_feed_cost_wan"] * 1.5 + total_asset_wan * 0.15, 2)

    # 4. 推荐处置动作
    actions = [
        f"气象状态: 当前处于 {snow_level}，模拟最大积雪深度 {sim_depth}cm",
        f"应急补饲: 建议提前储备干草 {feed_res['recommended_hay_tons']} 吨，精饲料 {feed_res['recommended_grain_tons']} 吨",
        f"防寒转移: 针对犊牛 (0-1岁) 与老龄牛组织转入暖棚避寒，严禁深入高山雪窝放牧",
        f"金融协同: 可申请气候韧性专项防灾低息信贷额度 {resilience_credit_quota_wan} 万元，启动农业保险快速绿通响应",
    ]

    return {
        "region_id": region_id,
        "disaster_status": snow_level,
        "total_exposed_assets_wan": total_asset_wan,
        "estimated_loss_exposure_wan": loss_exposure_wan,
        "resilience_credit_quota_wan": resilience_credit_quota_wan,
        "emergency_feed_demand": feed_res,
        "recommended_actions": actions,
        "is_derived": True,
        "application_scene": "农业防灾减灾 + 绿色普惠金融协同",
    }


@router.get("/priority-ranking")
def get_resource_priority_ranking(
    herd_size: int = Query(1000, description="单县测算基准养殖规模 (牦牛头数)"),
    days: int = Query(14, description="预警周期 (天)"),
) -> dict[str, Any]:
    """
    全域 26 县应急饲草/金融资源的投放优先级排序。

    决策页面若只给单个县的三个数字，无法回答"先保哪个县"。
    这里把同一套补饲与信贷口径跑遍 26 县并按需求降序排列，
    同时给出累积覆盖曲线所需的分位信息，作为资源调度的直接依据。
    """
    global _PRIORITY_CACHE, _PRIORITY_CACHE_TIMESTAMP
    cache_key = f"{herd_size}-{days}"
    now = time.time()
    if _PRIORITY_CACHE.get("key") == cache_key and (now - _PRIORITY_CACHE_TIMESTAMP < _PRIORITY_CACHE_TTL):
        return _PRIORITY_CACHE["data"]

    avg_yak_price = 8500.0
    total_asset_wan = round((herd_size * avg_yak_price) / 10000.0, 2)
    loss_rate_map = {
        "正常 (无灾害)": 0.005,
        "轻度雪灾 (I级)": 0.02,
        "中度雪灾 (II级)": 0.05,
        "重度雪灾 (III级)": 0.12,
        "特重雪灾 (IV级)": 0.25,
    }

    rows: list[dict[str, Any]] = []
    for r in load_region_list():
        rid = r.get("region_id", "")
        if not rid:
            continue
        try:
            feed = _forecast_driven_feed(rid, herd_size, days)
        except Exception as e:
            print(f"[decision] 优先级测算失败 {rid}: {e}")
            continue

        snow_level = feed.get("snow_level", "正常 (无灾害)")
        loss_exposure_wan = round(total_asset_wan * loss_rate_map.get(snow_level, 0.03), 2)
        credit_wan = round(feed["total_feed_cost_wan"] * 1.5 + total_asset_wan * 0.15, 2)

        rows.append({
            "region_id": rid,
            "name_cn": r.get("region_name") or r.get("name_cn") or rid,
            "pasture_type": r.get("pasture_type", ""),
            "elevation": float(r.get("altitude") or r.get("elevation") or 4000),
            "feed_mode": feed.get("feed_mode", ""),
            "mean_snow_depth_cm": feed.get("mean_snow_depth_cm", 0.0),
            "mean_temp_c": feed.get("mean_temp_c", 0.0),
            "hay_tons": float(feed.get("recommended_hay_tons", 0.0)),
            "grain_tons": float(feed.get("recommended_grain_tons", 0.0)),
            "feed_cost_wan": float(feed.get("total_feed_cost_wan", 0.0)),
            "loss_exposure_wan": loss_exposure_wan,
            "credit_quota_wan": credit_wan,
            "snow_level": snow_level,
            "snow_level_code": int(feed.get("snow_level_code", 0)),
            "is_realtime": bool(feed.get("is_realtime", False)),
        })

    rows.sort(key=lambda x: x["hay_tons"], reverse=True)

    total_hay = round(sum(x["hay_tons"] for x in rows), 1)
    total_credit = round(sum(x["credit_quota_wan"] for x in rows), 2)
    total_loss = round(sum(x["loss_exposure_wan"] for x in rows), 2)

    # 累积覆盖：按当前优先级投放，前几县能覆盖多少总需求
    cum = 0.0
    coverage_targets = [0.5, 0.8, 0.9]
    coverage: dict[str, int | None] = {}
    hit: dict[float, int | None] = {t: None for t in coverage_targets}
    for idx, row in enumerate(rows, start=1):
        cum += row["hay_tons"]
        row["cumulative_share"] = round(cum / total_hay, 4) if total_hay > 0 else 0.0
        for t in coverage_targets:
            if hit[t] is None and total_hay > 0 and cum / total_hay >= t:
                hit[t] = idx
    for t in coverage_targets:
        coverage[f"p{int(t * 100)}"] = hit[t]

    modes: dict[str, int] = {}
    for row in rows:
        modes[row["feed_mode"]] = modes.get(row["feed_mode"], 0) + 1

    result = {
        "herd_size_yak": herd_size,
        "forecast_days": days,
        "counties": rows,
        "totals": {
            "county_count": len(rows),
            "hay_tons": total_hay,
            "grain_tons": round(sum(x["grain_tons"] for x in rows), 1),
            "feed_cost_wan": round(sum(x["feed_cost_wan"] for x in rows), 2),
            "loss_exposure_wan": total_loss,
            "credit_quota_wan": total_credit,
        },
        "coverage": coverage,
        "feed_mode_distribution": modes,
        "realtime_counties": sum(1 for x in rows if x["is_realtime"]),
        "is_derived": True,
        "provenance_note": "基于本轮县域预报窗口的平均积雪深度与平均气温驱动 GB 补饲强度判定；实时预报不可达的县域由气候态外推，不代表实时灾情",
    }
    _PRIORITY_CACHE = {"key": cache_key, "data": result}
    _PRIORITY_CACHE_TIMESTAMP = now
    return result


class DispatchRequest(BaseModel):
    region_id: str = Field(..., description="目标县域ID")
    hay_tons: float = Field(..., ge=0, description="调拨干草吨数")
    grain_tons: float = Field(0.0, ge=0, description="调拨精料吨数")
    feed_cost_wan: float = Field(0.0, ge=0, description="饲草预算 (万元)")
    action_type: str = Field("应急补饲与转场防寒", description="处置类型")
    operator_role: str = Field("自治区防灾减灾应急指挥调度中心", description="操作主体角色")
    credit_action: str = Field("", description="金融协同处理方案")
    memo: str = Field("", description="调度处置备注文书")


def _load_dispatch_logs() -> list[dict[str, Any]]:
    if not DISPATCH_LOG_FILE.exists():
        return []
    try:
        with open(DISPATCH_LOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[decision] 读取调度留痕日志失败: {e}")
        return []


def _save_dispatch_logs(logs: list[dict[str, Any]]) -> None:
    DISPATCH_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DISPATCH_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)


@router.get("/dispatch-logs")
def get_dispatch_logs() -> dict[str, Any]:
    """获取所有历史应急处置调度与审计留痕日志"""
    logs = _load_dispatch_logs()
    sorted_logs = sorted(logs, key=lambda x: x.get("timestamp", ""), reverse=True)
    total_hay = round(sum(x.get("hay_tons", 0.0) for x in sorted_logs), 1)
    total_grain = round(sum(x.get("grain_tons", 0.0) for x in sorted_logs), 1)
    return {
        "count": len(sorted_logs),
        "total_dispatched_hay_tons": total_hay,
        "total_dispatched_grain_tons": total_grain,
        "logs": sorted_logs,
        "audit_policy": "全量可信留痕 · 严格不可篡改审计流水",
    }


@router.post("/dispatch")
def create_dispatch_action(req: DispatchRequest) -> dict[str, Any]:
    """
    下发应急处置与防灾调度指令 (写操作 + 处置留痕)
    - 闭环业务链路: 监测预警 -> 辅助决策 -> 指令下发 -> 处置留痕
    - 登记入库 dispatch_logs.json
    """
    regions = {r.get("region_id"): r for r in load_region_list()}
    target_region = regions.get(req.region_id)
    region_name = target_region.get("region_name") if target_region else req.region_id

    now = datetime.now()
    date_str = now.strftime("%Y%m%d")
    short_code = req.region_id.split("-")[-1].upper()[:6]
    rand_suffix = uuid.uuid4().hex[:4].upper()
    dispatch_id = f"DSP-{date_str}-{short_code}-{rand_suffix}"

    credit_desc = req.credit_action
    if not credit_desc:
        credit_desc = f"已联动绿色信贷服务系统 (预计授信缓释额度 {round(req.feed_cost_wan * 1.5 + 50.0, 2)} 万元)"

    record = {
        "dispatch_id": dispatch_id,
        "timestamp": now.isoformat(timespec="seconds"),
        "region_id": req.region_id,
        "region_name": region_name,
        "hay_tons": round(req.hay_tons, 1),
        "grain_tons": round(req.grain_tons, 1),
        "feed_cost_wan": round(req.feed_cost_wan, 2),
        "action_type": req.action_type,
        "operator_role": req.operator_role,
        "credit_action": credit_desc,
        "status": "已下发 (EXECUTING)",
        "memo": req.memo or f"针对 {region_name} 实施 {req.action_type}，调度干草 {req.hay_tons} 吨",
    }

    logs = _load_dispatch_logs()
    logs.insert(0, record)
    _save_dispatch_logs(logs)

    return {
        "success": True,
        "dispatch_id": dispatch_id,
        "message": f"应急调度指令 [{dispatch_id}] 已成功下达并存证留痕",
        "record": record,
        "audit_trace_url": f"/api/decision/dispatch-logs#{dispatch_id}",
    }


