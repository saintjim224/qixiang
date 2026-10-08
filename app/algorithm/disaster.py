"""
MeteoRiskPlatform - 五灾种多尺度预测与国标雪灾判定
=============================================================================
规范遵循:
- §4.5: 0–16 天走 Open-Meteo 实时预报 (snow_depth 单位 ×100 换算为厘米);
        17–90 天走气候态 + 历史概率;
        必须显式标注置信层级 (confidence_tier);
        严格执行国家标准 GB/T 20482-2006 牧区雪灾等级.
"""

from __future__ import annotations

import json
import math
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import OPEN_METEO_ENDPOINT
from app.core.dataio import get_region_meta, get_weather_series

# 预报缓存 (TTL = 1小时)。除霜/大风判定所需的日极值会随时间变化，缓存必须有
# 过期机制，否则演示服务器跑满一小时后仍会拿着上一轮的实时预报当"当前预报"。
_FORECAST_CACHE: dict[str, Any] = {}
_CACHE_TIMESTAMP: float = 0.0
_CACHE_TTL = 3600.0

# 每个县域本轮预报的**真实来源**。原实现只看预报时长就标注 realtime_forecast，
# 外网不可达时会把气候态降级结果冒充实时预报，必须如实披露。
_FORECAST_SOURCE: dict[str, str] = {}
_FORECAST_FALLBACK_REASON: dict[str, str] = {}
SOURCE_REALTIME = "open-meteo_realtime"
SOURCE_CLIMATOLOGY = "era5_climatological"

# 断网熔断：Open-Meteo 一旦确认不可达，在冷却期内不再逐县重试。
# 否则 26 县逐个等待 5s 超时，单次全量评估要卡 130s+，演示时会像"页面挂了"。
_NETWORK_DOWN_UNTIL: float = 0.0
_NETWORK_COOLDOWN = 300.0

# ---------------------------------------------------------------------------
# 灾种判定的公开标准阈值
# ---------------------------------------------------------------------------

# GB/T 20484-2017《寒潮等级》：24h 降温 ≥8℃ 或 48h 降温 ≥10℃，
# 且日最低气温 ≤4℃，方构成一次寒潮过程。
COLD_WAVE_DROP_24H_C = 8.0
COLD_WAVE_DROP_48H_C = 10.0
COLD_WAVE_TMIN_C = 4.0

# GB/T 28591-2012《风力等级》：(下限风速 m/s, 等级)
GALE_LEVELS: tuple[tuple[float, int], ...] = ((24.5, 10), (20.8, 9), (17.2, 8))

# 霜冻：日最低气温 ≤0℃ 为霜冻日，≤-2℃ 为重霜冻日
FROST_TMIN_C = 0.0
HARD_FROST_TMIN_C = -2.0

def classify_spi_drought(spi_value: float | None) -> str:
    """
    按 GB/T 20481-2017 由 SPI 判定气象干旱等级。

    直接委托给 spi 模块的全系统唯一分档表，避免同一 SPI 值在本模块与
    /api/index/spi、/api/index/method-compare 之间给出不一致的等级名。
    """
    from app.algorithm.spi import classify_spi_gb

    level = classify_spi_gb(spi_value)
    return level if level is not None else "不可用"


def classify_wind_level(speed_mps: float | None) -> int | None:
    """按 GB/T 28591-2012 把最大风速换算为风力等级 (仅返回 8 级及以上)。"""
    if speed_mps is None:
        return None
    for lower, level in GALE_LEVELS:
        if speed_mps >= lower:
            return level
    return None


def evaluate_cold_wave(
    temp_min: list[float],
) -> dict[str, Any]:
    """
    按 GB/T 20484-2017 在逐日最低气温序列上识别寒潮过程。

    旧实现只判 `min_temp < -20℃` 就算"高风险"，那衡量的是「冷」而不是「寒潮」——
    寒潮的本质是**短时间内剧烈降温**，一个本就严寒但气温平稳的冬季并不构成寒潮。
    这里改为国标的两条判据：24h 降温 ≥8℃ 或 48h 降温 ≥10℃，且最低气温 ≤4℃。
    """
    temps = [float(t) for t in temp_min if t is not None]
    if not temps:
        return {
            "available": False,
            "reason": "预报序列缺少日最低气温，无法按 GB/T 20484 判定寒潮",
        }

    events: list[dict[str, Any]] = []
    for i, t in enumerate(temps):
        drop24 = temps[i - 1] - t if i >= 1 else None
        drop48 = temps[i - 2] - t if i >= 2 else None
        hit24 = drop24 is not None and drop24 >= COLD_WAVE_DROP_24H_C
        hit48 = drop48 is not None and drop48 >= COLD_WAVE_DROP_48H_C
        if (hit24 or hit48) and t <= COLD_WAVE_TMIN_C:
            events.append({
                "day_index": i + 1,
                "temp_min_c": round(t, 1),
                "drop_24h_c": None if drop24 is None else round(drop24, 1),
                "drop_48h_c": None if drop48 is None else round(drop48, 1),
                "trigger": "24h降温≥8℃" if hit24 else "48h降温≥10℃",
            })

    return {
        "available": True,
        "min_forecast_temp_c": round(min(temps), 1),
        "cold_wave_days": len(events),
        "events": events,
        "cold_wave_risk": (
            "高" if len(events) >= 2 else ("中" if len(events) == 1 else "低")
        ),
        "standard": "GB/T 20484-2017",
    }


def evaluate_gale(wind_max: list[float]) -> dict[str, Any]:
    """按 GB/T 28591-2012 统计预报窗口内的大风日 (8 级及以上)。"""
    winds = [float(w) for w in wind_max if w is not None]
    if not winds:
        return {
            "available": False,
            "reason": "预报序列缺少日最大风速，无法按 GB/T 28591 判定大风",
        }
    peak = max(winds)
    level = classify_wind_level(peak)
    return {
        "available": True,
        "max_wind_speed_mps": round(peak, 1),
        "max_wind_level": level,
        "gale_days": sum(1 for w in winds if classify_wind_level(w) is not None),
        "gale_risk": "高" if level and level >= 9 else ("中" if level else "低"),
        "standard": "GB/T 28591-2012",
    }


def evaluate_frost(temp_min: list[float]) -> dict[str, Any]:
    """统计预报窗口内的霜冻日与重霜冻日。"""
    temps = [float(t) for t in temp_min if t is not None]
    if not temps:
        return {
            "available": False,
            "reason": "预报序列缺少日最低气温，无法判定霜冻",
        }
    frost_days = sum(1 for t in temps if t <= FROST_TMIN_C)
    hard_frost_days = sum(1 for t in temps if t <= HARD_FROST_TMIN_C)
    return {
        "available": True,
        "min_forecast_temp_c": round(min(temps), 1),
        "frost_days": frost_days,
        "hard_frost_days": hard_frost_days,
        "frost_risk": "高" if hard_frost_days >= 3 else ("中" if frost_days >= 1 else "低"),
        "standard": "日最低气温 ≤0℃ 为霜冻日；≤-2℃ 为重霜冻日",
    }


def evaluate_drought(region_id: str) -> dict[str, Any]:
    """
    复用本系统已实现的 Gamma-MLE SPI 引擎判定气象干旱 (GB/T 20481-2017)。

    直接调用 app.algorithm.spi，不另起一套算法，保证与 /api/index/spi 的
    结果同源、不会出现同一县两个不同的干旱等级。
    """
    try:
        from app.algorithm.spi import calculate_spi
    except Exception as e:
        return {"available": False, "reason": f"SPI 模块不可用: {e}"}

    out: dict[str, Any] = {"available": False, "standard": "GB/T 20481-2017"}
    for scale in (3, 12):
        try:
            res = calculate_spi(region_id=region_id, scale=scale)
        except Exception as e:
            out[f"spi_{scale}_error"] = str(e)
            continue
        val = res.get("spi_value")
        out[f"spi_{scale}"] = val
        out[f"level_spi_{scale}"] = classify_spi_drought(val)
        out[f"samples_spi_{scale}"] = res.get("historical_years_count")
        if val is not None:
            out["available"] = True
    if not out["available"]:
        out.setdefault("reason", "该县降水序列不足，SPI 无法拟合")
    return out


def _climatological_snow_rate(region_id: str) -> tuple[float, int]:
    """
    本县「当前日历月」相邻月份间的平均积雪深度日变化速率 (cm/天)，可正可负。

    替代旧实现在 17-30 天分支写死的 `cur_s = cur_s * 0.92`——那个 0.92 没有任何
    数据来源，等于凭空规定"每天都融掉 8%"。改用该县同月真实月际变化的经验值。
    """
    from datetime import date
    import statistics

    month = date.today().month
    series = get_weather_series(region_id) or []

    rows: list[tuple[str, float]] = []
    for row in series:
        raw = row.get("observed_at") or row.get("month") or ""
        txt = str(raw)[:7]
        if len(txt) != 7:
            continue
        rows.append((txt, float(row.get("snow_depth_cm") or 0.0)))
    rows.sort(key=lambda x: x[0])

    deltas: list[float] = []
    for i in range(1, len(rows)):
        month_i = int(rows[i][0][-2:])
        month_prev = int(rows[i - 1][0][-2:])
        # 只取跨越到当前日历月的相邻月对
        if month_i == month and (month_prev == month - 1 or (month == 1 and month_prev == 12)):
            deltas.append(rows[i][1] - rows[i - 1][1])

    if not deltas:
        return 0.0, 0
    return round(statistics.mean(deltas) / 30.0, 4), len(deltas)


def _climatological_frost(region_id: str) -> dict[str, Any]:
    """
    本县「当前日历月」历史月均温 ≤0℃ 的年份占比，作为该月霜冻气候态频率。

    注意口径：这是**月均气温**统计出的气候背景，不是逐日霜冻日数，
    因为源数据 weather_data.json 只到月尺度。
    """
    from datetime import date

    month = date.today().month
    series = get_weather_series(region_id) or []
    month_rows = [
        r for r in series
        if str(r.get("observed_at") or r.get("month") or "")[:7][-2:].isdigit()
        and int(str(r.get("observed_at") or r.get("month") or "")[:7][-2:]) == month
    ]
    if not month_rows:
        return {"available": False, "reason": "缺少该月历史记录"}
    temps = [float(r.get("temperature_c")) for r in month_rows if r.get("temperature_c") is not None]
    if not temps:
        return {"available": False, "reason": "缺少该月气温记录"}
    cold_years = sum(1 for t in temps if t <= 0.0)
    return {
        "available": True,
        "climatological_frost_frequency": round(cold_years / len(temps), 3),
        "sample_years": len(temps),
        "mean_temp_c": round(sum(temps) / len(temps), 1),
        "basis": "月平均气温口径的气候态频率，非逐日霜冻日数",
    }


def _complete_daily_forecast(daily: Any, days: int = 16) -> bool:
    """只有完整有限的逐日值才可用于实时窗口，不能把空值当作零或默认低温。"""
    if not isinstance(daily, dict):
        return False
    for key in ("temperature_2m_max", "temperature_2m_min", "snowfall_sum", "wind_speed_10m_max"):
        values = daily.get(key)
        if not isinstance(values, list) or len(values) < days:
            return False
        for value in values[:days]:
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
                return False
            if key in ("snowfall_sum", "wind_speed_10m_max") and value < 0:
                return False
    return True


def fetch_open_meteo_forecast(region_ids: list[str]) -> dict[str, dict[str, Any]]:
    """批量获取 Open-Meteo 16 天逐日气象预报 (支持按县域增量缓存)."""
    global _FORECAST_CACHE, _CACHE_TIMESTAMP, _NETWORK_DOWN_UNTIL

    # 缓存过期：整批预报一并作废重新抓取，保证日极值类判据（霜冻/大风/寒潮）
    # 始终基于最新的实时窗口，而不是一小时前的旧窗口。
    if _FORECAST_CACHE and (time.time() - _CACHE_TIMESTAMP) > _CACHE_TTL:
        _FORECAST_CACHE = {}
        _FORECAST_SOURCE.clear()
        _FORECAST_FALLBACK_REASON.clear()

    missing_rids = [rid for rid in region_ids if rid not in _FORECAST_CACHE]
    if not missing_rids:
        return {rid: _FORECAST_CACHE[rid] for rid in region_ids if rid in _FORECAST_CACHE}

    lats: list[float] = []
    lons: list[float] = []
    valid_rids: list[str] = []

    for rid in missing_rids:
        meta = get_region_meta(rid)
        if meta and meta.get("latitude") and meta.get("longitude"):
            lats.append(float(meta["latitude"]))
            lons.append(float(meta["longitude"]))
            valid_rids.append(rid)

    if valid_rids and time.time() < _NETWORK_DOWN_UNTIL:
        # 冷却期内直接走气候态，避免每个县都白等一次超时
        for rid in valid_rids:
            _FORECAST_CACHE[rid] = _generate_climatological_forecast(rid, days=16)
            _FORECAST_SOURCE[rid] = SOURCE_CLIMATOLOGY
            _FORECAST_FALLBACK_REASON[rid] = "外部预报连接处于失败后的重试冷却期"
    elif valid_rids:
        params = {
            "latitude": ",".join(f"{lat:.4f}" for lat in lats),
            "longitude": ",".join(f"{lon:.4f}" for lon in lons),
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max",
            "timezone": "Asia/Shanghai",
            "wind_speed_unit": "ms",
            "forecast_days": 16,
        }
        url = f"{OPEN_METEO_ENDPOINT}?{urlencode(params)}"
        try:
            req = Request(url, headers={"User-Agent": "MeteoRiskPlatform/1.0"})
            with urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            items = data if isinstance(data, list) else [data]
            for idx, rid in enumerate(valid_rids):
                item = items[idx] if idx < len(items) else None
                daily = item.get("daily") if isinstance(item, dict) else None
                if _complete_daily_forecast(daily):
                    _FORECAST_CACHE[rid] = daily
                    _FORECAST_SOURCE[rid] = SOURCE_REALTIME
                    _FORECAST_FALLBACK_REASON.pop(rid, None)
                else:
                    _FORECAST_CACHE[rid] = _generate_climatological_forecast(rid, days=16)
                    _FORECAST_SOURCE[rid] = SOURCE_CLIMATOLOGY
                    _FORECAST_FALLBACK_REASON[rid] = "外部预报未返回完整的 16 天温度、降雪或风速数据"
        except Exception:
            # 降级：基于历史真实气候态生成逐日预测，并如实标注来源
            _NETWORK_DOWN_UNTIL = time.time() + _NETWORK_COOLDOWN
            for rid in valid_rids:
                _FORECAST_CACHE[rid] = _generate_climatological_forecast(rid, days=16)
                _FORECAST_SOURCE[rid] = SOURCE_CLIMATOLOGY
                _FORECAST_FALLBACK_REASON[rid] = "外部预报请求失败"

    # 仅在确实写入过缓存时刷新时间戳，避免"没抓到任何东西"也把旧缓存续命
    if valid_rids:
        _CACHE_TIMESTAMP = time.time()
    return {rid: _FORECAST_CACHE.get(rid, {}) for rid in region_ids}


def _generate_climatological_forecast(region_id: str, days: int = 16) -> dict[str, Any]:
    """
    离线降级预报：以**当前日历月**的历史同期气候态外推。

    原实现固定取冬季 (12/01/02 月) 均值作为基准，导致 9 月也会报出 30cm+ 积雪与
    "连续积雪 19 天"，再经 GB/T 20482 判成特重雪灾——属于季节错配，必须按当前月份取值。
    """
    from datetime import date

    month = date.today().month
    w_series = get_weather_series(region_id)

    def _month_of(row: dict[str, Any]) -> int | None:
        raw = row.get("month") or str(row.get("observed_at", ""))[:7]
        tail = str(raw)[-2:]
        return int(tail) if tail.isdigit() else None

    if not w_series:
        base_temp, base_snow = -10.0, 0.0
    else:
        same_month = [r for r in w_series if _month_of(r) == month]
        target_rows = same_month[-5:] if same_month else w_series[-5:]
        base_temp = sum(float(r["temperature_c"]) if r.get("temperature_c") is not None else -10.0 for r in target_rows) / len(target_rows)
        base_snow = sum(float(r.get("snow_depth_cm") or 0.0) for r in target_rows) / len(target_rows)

    # 降雪量必须与气温自洽：月均温远高于冰点时不可能持续降雪并形成稳定积雪，
    # 否则会出现"日均气温 +7℃ 却连续积雪 16 天"这种一眼假的组合。
    snowfall = round(max(0.0, base_snow) * 0.15, 1) if base_temp <= 1.0 else 0.0

    return {
        "temperature_2m_max": [round(base_temp + 2.0, 1)] * days,
        "temperature_2m_min": [round(base_temp - 4.0, 1)] * days,
        "precipitation_sum": [1.5] * days,
        "snowfall_sum": [snowfall] * days,
        "wind_speed_10m_max": [5.0] * days,
        "base_snow": round(base_snow, 1),
    }


def _same_month_snow_sigma(region_id: str) -> tuple[float, int]:
    """
    本县「当前日历月」历史积雪深度的年际标准差，用作不确定区间的量纲。

    原实现把区间写死成 ±2.5cm / ±4.5cm，是凭空的数字，一问来源就站不住。
    改用真实可解释的量：同月各年积雪深度的 1σ，含义是"该月积雪的年际波动幅度"。
    返回 (sigma, 样本年数)。
    """
    from datetime import date
    import statistics

    month = date.today().month
    series = get_weather_series(region_id) or []

    depths: list[float] = []
    for row in series:
        raw = row.get("month") or str(row.get("observed_at", ""))[:7]
        tail = str(raw)[-2:]
        if tail.isdigit() and int(tail) == month:
            depths.append(float(row.get("snow_depth_cm") or 0.0))

    if len(depths) < 2:
        return 0.0, len(depths)
    return round(statistics.pstdev(depths), 2), len(depths)


def evaluate_snow_disaster_gb(snow_depth_cm: float, continuous_days: int) -> dict[str, Any]:
    """严格执行国家标准 GB/T 20482-2006《牧区雪灾等级》评级."""
    if continuous_days >= 10 and snow_depth_cm >= 20.0:
        return {"level_code": 4, "level_cn": "特重雪灾 (IV级)", "action_advice": "启动一级应急预案，调集全区应急储备饲草与防寒物资"}
    elif continuous_days >= 7 and snow_depth_cm >= 15.0:
        return {"level_code": 3, "level_cn": "重度雪灾 (III级)", "action_advice": "组织弱幼畜转入暖棚，实施 100% 补饲"}
    elif continuous_days >= 5 and snow_depth_cm >= 10.0:
        return {"level_code": 2, "level_cn": "中度雪灾 (II级)", "action_advice": "加密巡视，准备应急饲料，重点关注犊牛保暖"}
    elif continuous_days >= 3 and snow_depth_cm >= 5.0:
        return {"level_code": 1, "level_cn": "轻度雪灾 (I级)", "action_advice": "发布气象预警，提醒牧户做好防风防雪准备"}
    else:
        return {"level_code": 0, "level_cn": "正常 (无灾害)", "action_advice": "常规放牧管理"}


def predict_disasters(region_id: str, days_ahead: int = 30) -> dict[str, Any]:
    """
    五灾种综合预测 (雪灾、寒潮、大风、干旱、霜冻):
    - 0-16 天: 显式标注 confidence_tier="realtime_forecast"
    - 17-90 天: 显式标注 confidence_tier="climatological_projection"
    """
    forecasts_all = fetch_open_meteo_forecast([region_id])
    daily_16 = forecasts_all.get(region_id, {})

    # 计算 16 天内雪灾指标
    snowfall_list = daily_16.get("snowfall_sum", [])
    temp_max_list = daily_16.get("temperature_2m_max", [])
    temp_min_list = daily_16.get("temperature_2m_min", [])
    base_snow = float(daily_16.get("base_snow", 0.0) or 0.0)

    # 积雪深度与连续积雪天数必须由**同一条逐日状态序列**推导：
    # 原实现一边用"只增不减"的累加算出国标等级，一边用另一套带融雪的公式画图，
    # 导致卡片写"积雪 5.8cm / 连续 16 天"、曲线却一路融到 0，自相矛盾。
    # 另外降雪必须在冰点附近才可能积起来，正积温下应融雪而非积雪。
    cockpit_days = [f"D+{i+1}" for i in range(16)]
    cockpit_temps: list[float] = []
    cockpit_snow: list[float] = []

    depth = max(0.0, base_snow)
    max_continuous_snow_days = 0
    current_continuous = 0

    for i in range(16):
        sf = float(snowfall_list[i] or 0.0) if i < len(snowfall_list) else 0.0
        t_hi = float(temp_max_list[i]) if i < len(temp_max_list) else -5.0
        t_lo = float(temp_min_list[i]) if i < len(temp_min_list) else -15.0
        avg_t = round((t_hi + t_lo) / 2.0, 1)
        cockpit_temps.append(avg_t)

        if sf >= 0.1 and avg_t <= 1.0:
            # 冰点附近：降雪有效积累
            depth = min(60.0, depth + sf * 0.8)
            current_continuous += 1
            max_continuous_snow_days = max(max_continuous_snow_days, current_continuous)
        else:
            # 融雪：正积温越强消融越快
            if avg_t > 0.0:
                depth = max(0.0, depth - (0.6 + avg_t * 0.25))
            elif avg_t > -2.0:
                depth = max(0.0, depth - 0.3)
            current_continuous = max(0, current_continuous - 1)

        cockpit_snow.append(round(depth, 1))

    # 国标按整个预报窗口内的最大积雪深度 + 最长连续积雪天数判定
    max_snow_depth = max(cockpit_snow) if cockpit_snow else round(base_snow, 1)
    snow_eval = evaluate_snow_disaster_gb(max_snow_depth, max_continuous_snow_days)

    # 寒潮 (GB/T 20484-2017)：判"剧烈降温过程"，而非"气温低"
    cold_wave = evaluate_cold_wave(temp_min_list)
    min_temp = cold_wave.get("min_forecast_temp_c")

    # 大风 (GB/T 28591-2012) 与霜冻：数据早在 fetch 阶段就已取回，
    # 旧实现取回后既不使用也未在返回中体现，导致接口声称五灾种却只给两灾种。
    gale = evaluate_gale(daily_16.get("wind_speed_10m_max", []))
    frost = evaluate_frost(temp_min_list)

    # 干旱 (GB/T 20481-2017)：复用本系统 SPI 引擎，与 /api/index/spi 同源
    drought = evaluate_drought(region_id)

    # 17 天以后没有实时驱动，按该县**同月真实月际变化率**外推，
    # 替代旧实现写死的 `cur_s * 0.92`（那个系数没有任何数据来源）。
    horizon = max(1, min(int(days_ahead), 90))
    snow_rate, rate_samples = _climatological_snow_rate(region_id)

    days_horizon = [f"D+{i+1}" for i in range(horizon)]
    snow_horizon: list[float] = []
    cur_s = cockpit_snow[-1] if cockpit_snow else round(base_snow, 1)
    for i in range(horizon):
        if i < 16:
            val = cockpit_snow[i]
        else:
            cur_s = max(0.0, round(cur_s + snow_rate, 2))
            val = cur_s
        snow_horizon.append(val)

    # 不确定区间 = 同月历史积雪年际 1σ；17 天以后没有实时驱动，按 1.5σ 放宽
    sigma, sigma_years = _same_month_snow_sigma(region_id)
    snow_ci_upper = [round(v + sigma * (1.0 if i < 16 else 1.5), 1) for i, v in enumerate(snow_horizon)]
    snow_ci_lower = [round(max(0.0, v - sigma * (1.0 if i < 16 else 1.5)), 1) for i, v in enumerate(snow_horizon)]

    # 数据口径必须如实反映这一轮预报究竟来自实时接口还是离线气候态降级
    data_source = _FORECAST_SOURCE.get(region_id, SOURCE_CLIMATOLOGY)
    is_realtime = data_source == SOURCE_REALTIME

    # 第 16 天是"实时预报 → 气候态外推"的口径分界，供前端画分界线并切换线型
    boundary_index = 16 if horizon > 16 else None

    return {
        "region_id": region_id,
        "days_ahead": days_ahead,
        "horizon_days": horizon,
        "confidence_tier": "realtime_forecast" if (is_realtime and horizon <= 16) else "climatological_projection",
        "data_source": data_source,
        "is_realtime": is_realtime,
        "fallback_reason": _FORECAST_FALLBACK_REASON.get(region_id) if not is_realtime else None,
        "snow_disaster": {
            "max_simulated_snow_depth_cm": round(max_snow_depth, 1),
            "continuous_snow_days": max_continuous_snow_days,
            **snow_eval,
        },
        "cold_wave": cold_wave,
        "gale": gale,
        "frost": frost,
        "drought": drought,
        # 五灾种一览：便于前端与调用方一眼看全，等级统一为 高/中/低/不可用
        "disaster_summary": {
            "snow": {"level_code": snow_eval.get("level_code"), "level_cn": snow_eval.get("level_cn")},
            "cold_wave": {"risk": cold_wave.get("cold_wave_risk") if cold_wave.get("available") else "不可用"},
            "gale": {"risk": gale.get("gale_risk") if gale.get("available") else "不可用"},
            "drought": {"level_spi_3": drought.get("level_spi_3"), "level_spi_12": drought.get("level_spi_12")},
            "frost": {"risk": frost.get("frost_risk") if frost.get("available") else "不可用"},
        },
        "forecast_series": {
            # 前 16 天：真实实时预报窗口
            "days_16": cockpit_days,
            "temps_16": cockpit_temps,
            "snow_16": cockpit_snow,
            # 完整预报视野（长度 = horizon_days）；键名保留 _30 以兼容既有前端，
            # 实际长度以 horizon_days 为准，前端重构时再统一改名。
            "days_30": days_horizon,
            "snow_depth_30": snow_horizon,
            "ci_upper_30": snow_ci_upper,
            "ci_lower_30": snow_ci_lower,
            "boundary_index": boundary_index,
        },
        "uncertainty": {
            # 区间口径必须随结果一起给出，否则使用者无从判断带宽意味着什么
            "sigma_cm": sigma,
            "sample_years": sigma_years,
            "method": "本县同月历史积雪深度年际标准差 (1σ)；17 天以后按 1.5σ 放宽",
            "extrapolation": (
                f"17 天以后按本县同月积雪深度的真实月际变化率 {snow_rate} cm/天 外推"
                f"（基于 {rate_samples} 组相邻月对），非固定衰减系数"
            ),
        },
        "climatological_frost": _climatological_frost(region_id),
        "is_derived": True,
        "provenance_note": (
            "0-16天基于 Open-Meteo 实时气象驱动; 超过16天基于 ERA5 气候态外推"
            if is_realtime
            else (_FORECAST_FALLBACK_REASON.get(region_id, "Open-Meteo 实时预报不可用")
                  + "；本结果由历史同期气候态及设定参数外推生成，仅供气候背景参考，不代表实时灾情")
        ),
    }
