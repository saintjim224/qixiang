#!/usr/bin/env python3
"""
SPI 拟合窗口消融实验（独立诊断，不触碰主算法链）

为什么需要这个脚本
------------------
`tools/cross_validate_spi.py` 显示：本系统自研 SPI 与第三方 spei 独立实现的
相关系数中位仅约 0.57、分档一致率中位约 30%。但这个比较里混入了两个变量：

    (1) 拟合窗口不同：本系统只用 [起始年, 目标年) 的历史同月样本拟合 Gamma，
        而 spei 用整条序列（全部年份）拟合；
    (2) 实现细节不同。

因此"低相关"不能直接归因于"实现写错了"。本脚本把窗口变量单独隔离出来：

    A 现状口径   : 本系统实现，窗口 = 目标年之前
    B 全记录口径 : 同样的公式，窗口 = 全部年份（SPI 的标准做法）
    C 第三方参照 : spei 库，窗口 = 全部年份

A 与 B 的对比量化"窗口选择"的纯效应；B 与 C 的对比才隔离出"实现差异"。

本脚本刻意不做的事
------------------
不修改主算法、不写入任何运行时数据、不替换 `/api/index/spi` 的任何取值。
它的结论是**披露性的**：说明当前实现与标准做法差多少，供方法材料引用与
后续决策，而非自动"修正"主链。

用法
----
    python tools/spi_window_ablation.py
"""

from __future__ import annotations

import sys
import warnings
from collections import defaultdict
from pathlib import Path

# 第三方实现与 numpy/scipy 在样本极少时会刷大量 RuntimeWarning，
# 那正是本脚本要量化的现象。
warnings.filterwarnings("ignore")

# Windows 控制台 UTF-8 输出防护（与 app/algorithm/spi.py 同一处理）
if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402

from app.core.dataio import get_era5_daily, load_region_list  # noqa: E402

EPS = 1e-4
CLIP = 1e-6
SCALES = (3, 12)


def _classify(value: float | None) -> str | None:
    """按 GB/T 20481-2017 分档，用于跨实现比较分档一致率。"""
    from app.algorithm.spi import classify_spi_gb

    return classify_spi_gb(value)


def monthly_series(region_id: str) -> dict[str, float]:
    monthly: dict[str, float] = defaultdict(float)
    for rec in get_era5_daily(region_id):
        monthly[rec["date"][:7]] += float(rec.get("precip_mm") or 0.0)
    return dict(monthly)


def _window_keys(year: int, month: int, scale: int) -> list[str]:
    keys: list[str] = []
    for i in range(scale):
        cm, cy = month - i, year
        if cm <= 0:
            cm += 12
            cy -= 1
        keys.append(f"{cy}-{cm:02d}")
    return keys


def cumulant(monthly: dict[str, float], year: int, month: int, scale: int) -> float | None:
    """该月的 scale 月累计降水；任一月份缺失则返回 None，避免序列开头的伪零降水。"""
    keys = _window_keys(year, month, scale)
    if any(k not in monthly for k in keys):
        return None
    return sum(monthly[k] for k in keys)


def gamma_spi(current: float, hist: list[float]) -> float | None:
    """本系统的 SPI 公式：Gamma-MLE(floc=0) + 零降水概率混合边界。"""
    if len(hist) < 2:
        return None
    n = len(hist)
    q = sum(1 for c in hist if c <= EPS) / float(n)
    non_zero = [c for c in hist if c > EPS]
    if len(non_zero) < 2:
        return 0.0 if current <= EPS else 1.5
    try:
        alpha, _, beta = stats.gamma.fit(non_zero, floc=0)
        g_x = 0.0 if current <= EPS else float(stats.gamma.cdf(current, a=alpha, scale=beta))
        h_x = min(max(q + (1.0 - q) * g_x, CLIP), 1.0 - CLIP)
        return float(stats.norm.ppf(h_x))
    except Exception:
        return None


def eval_months(monthly: dict[str, float], scale: int):
    """产出 (目标月, 当前累计, 目标年之前的同月样本, 全记录同月样本)。"""
    years = sorted({int(k[:4]) for k in monthly})
    start_year = years[0]
    for ym in sorted(monthly):
        year, month = int(ym[:4]), int(ym[5:7])
        current = cumulant(monthly, year, month, scale)
        if current is None:
            continue
        prior = [c for hy in range(start_year, year)
                 if (c := cumulant(monthly, hy, month, scale)) is not None]
        full = [c for hy in years
                if (c := cumulant(monthly, hy, month, scale)) is not None]
        if len(prior) < 2 or len(full) < 2:
            continue
        yield ym, current, prior, full


def main() -> int:
    try:
        from spei import spi as spei_spi
    except ImportError as exc:
        raise SystemExit(
            f"[中止] 未安装 spei（{exc}）。\n"
            f"       本脚本用第三方实现作为参照，请先执行：pip install spei"
        )

    rows = load_region_list()
    region_ids = [r["region_id"] for r in rows] if rows else ["naqu-bange"]

    collected: dict[str, tuple[list[float], list[float]]] = {}
    sample_sizes: list[tuple[int, int]] = []

    for rid in region_ids:
        monthly = monthly_series(rid)
        if not monthly:
            continue
        series = pd.Series(monthly).sort_index()
        series.index = pd.to_datetime(series.index)
        for scale in SCALES:
            ref = spei_spi(series, timescale=scale).dropna()
            for ym, current, prior, full in eval_months(monthly, scale):
                ts = pd.Timestamp(f"{ym}-01")
                if ts not in ref.index:
                    continue
                ours_prior = gamma_spi(current, prior)
                ours_full = gamma_spi(current, full)
                if ours_prior is None or ours_full is None:
                    continue
                ref_val = float(ref.loc[ts])
                sample_sizes.append((len(prior), len(full)))
                for label, value in (("A 现状(用目标年之前)", ours_prior),
                                     ("B 全记录(SPI 标准做法)", ours_full)):
                    collected.setdefault(label, ([], []))
                    collected[label][0].append(value)
                    collected[label][1].append(ref_val)

    if not collected:
        print("[结果] 无可比月份，请确认 ERA5 数据已就位。")
        return 1

    print("=" * 94)
    print(" SPI 拟合窗口消融：隔离『窗口选择』与『实现差异』（参照 = 第三方 spei）")
    print("=" * 94)
    print(f"{'口径':<26}{'可比月':>8}{'Pearson r':>12}{'MAE':>10}{'最大差':>10}{'分档一致':>10}")
    print("-" * 94)
    for label, (ours, ref) in collected.items():
        a, b = np.asarray(ours), np.asarray(ref)
        r = stats.pearsonr(a, b)[0] if np.std(a) > 0 and np.std(b) > 0 else float("nan")
        band = float(np.mean([_classify(x) == _classify(y) for x, y in zip(a, b)]))
        print(f"{label:<26}{len(a):>8}{r:>12.4f}"
              f"{float(np.mean(np.abs(a - b))):>10.4f}"
              f"{float(np.max(np.abs(a - b))):>10.4f}{band:>10.4f}")

    print("-" * 94)
    a_val = np.asarray(collected["A 现状(用目标年之前)"][0])
    b_val = np.asarray(collected["B 全记录(SPI 标准做法)"][0])
    band_ab = float(np.mean([_classify(x) == _classify(y) for x, y in zip(a_val, b_val)]))
    print(f"A vs B（同一公式，仅换拟合窗口）: r={stats.pearsonr(a_val, b_val)[0]:.4f}  "
          f"MAE={float(np.mean(np.abs(a_val - b_val))):.4f}  "
          f"最大差={float(np.max(np.abs(a_val - b_val))):.4f}  分档一致={band_ab:.4f}")
    print(f"拟合样本数: 目标年之前 n∈[{min(p for p, _ in sample_sizes)}, "
          f"{max(p for p, _ in sample_sizes)}]    "
          f"全记录 n∈[{min(f for _, f in sample_sizes)}, {max(f for _, f in sample_sizes)}]")
    print("=" * 94)
    print("读法：A 与 B 的差距说明『窗口选择』本身就有多大影响；B 与 C（第三方）的差距")
    print("      才反映『实现差异』。两者都受制于同一根本约束——ERA5 仅 6 年，每个")
    print("      日历月最多 6 个样本，远低于 WMO 对 SPI 建议的 ≥30 年。")
    print("=" * 94)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
