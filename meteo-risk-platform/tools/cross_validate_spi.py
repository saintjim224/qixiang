#!/usr/bin/env python3
"""
SPI 交叉校验：用第三方 `spei` 库的独立实现，核验本系统自研的 Gamma-MLE SPI。

为什么需要这个脚本
------------------
本系统的 SPI 是自研实现（scipy.stats.gamma.fit(floc=0) + 零降水概率修正）。
自研实现最怕的不是把公式写错，而是**自己验证自己**——同一份代码既生产结果、
又充当正确性的判据。所以这里引入 spei（MIT，独立实现：按日历月分别拟合 Gamma、
按经验频率修正零值概率）在**完全相同的输入降水序列**上重算一遍，把差异量化出来。

本脚本刻意的三条"不"：
  1. 不改动任何主算法、不写入任何运行时数据；
  2. 不隐藏不利结果——相关系数、MAE、分档一致率与原实现拟合所用的样本数**并列输出**；
  3. 不把"两边算出来都是数"当成"两边算得对"，小样本会单独告警。

用法
----
    python tools/cross_validate_spi.py                          # 全部 26 县，scale=3 与 12
    python tools/cross_validate_spi.py --region naqu-bange
    python tools/cross_validate_spi.py --scale 3 --json tools/out/spi_cross_check.json

输出字段
--------
    n_pairs   本系统与 spei 都有值、可比的月份数
    r         Pearson 相关系数
    mae       平均绝对差
    max_diff  最大绝对差
    band_agree 按 GB/T 20481-2017 分档的一致率
    nn_min/max 本系统拟合该月 Gamma 参数所用的历史同月样本数区间

**读这张表时必须连着 nn_min 一起看。** n 很小（如 n=2）时即便 r 很高，
该 SPI 值也只是两个数撑起来的插值，不具备气候统计意义。
"""

from __future__ import annotations

import argparse
import json
import sys
import warnings
from collections import defaultdict
from pathlib import Path
from typing import Any

# 第三方 SPI 实现与 numpy/scipy 在样本极少时会刷大量 RuntimeWarning，
# 那正是本脚本要量化的现象，不该淹没在刷屏里。
warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from scipy import stats  # noqa: E402

from app.algorithm.spi import calculate_spi, classify_spi_gb  # noqa: E402
from app.core.dataio import get_era5_daily, load_region_list  # noqa: E402

# 本系统 SPI 的 Gamma 参数由多少个历史同月样本拟合而来，低于此数即认为
# 该月的指数不足以支撑气候统计意义上的分档结论。
MIN_TRUSTWORTHY_SAMPLES = 10


def build_monthly_series(region_id: str) -> "pd.Series":
    """把逐日 ERA5 降水汇总成月度降水序列（DatetimeIndex，升序）。"""
    records = get_era5_daily(region_id)
    monthly: dict[str, float] = defaultdict(float)
    for rec in records:
        monthly[rec["date"][:7]] += float(rec.get("precip_mm") or 0.0)
    series = pd.Series(monthly).sort_index()
    if series.empty:
        return series
    series.index = pd.to_datetime(series.index)
    return series


def cross_check_region(
    region_id: str, scales: tuple[int, ...] = (3, 12)
) -> list[dict[str, Any]]:
    """对单个县域的每个尺度做一次交叉校验，返回逐尺度的统计量。"""
    try:
        from spei import spi as spei_spi
    except ImportError as exc:  # 缺库时明确告知，而不是静默跳过
        raise SystemExit(
            f"[中止] 未安装 spei（{exc}）。\n"
            f"       本脚本依赖第三方实现做交叉校验，请先执行：\n"
            f"       pip install spei"
        )

    series = build_monthly_series(region_id)
    if series.empty:
        return [
            {
                "region_id": region_id,
                "scale": s,
                "error": "该县域无逐日 ERA5 降水记录",
            }
            for s in scales
        ]

    results: list[dict[str, Any]] = []

    for scale in scales:
        # --- 第三方实现：整条序列一次性拟合（各日历月分别拟合） ---
        ref = spei_spi(series, timescale=scale)
        ref = ref.dropna()
        if ref.empty:
            results.append(
                {"region_id": region_id, "scale": scale, "error": "spei 未产出有效值"}
            )
            continue

        ours: list[float] = []
        theirs: list[float] = []
        n_samples_used: list[int] = []
        band_hit = 0

        for ts in ref.index:
            target_month = ts.strftime("%Y-%m")
            try:
                res = calculate_spi(region_id, scale=scale, target_month=target_month)
            except Exception as exc:  # 单月失败不应中断整县
                print(f"    [警告] {region_id} {target_month} 计算失败: {exc}")
                continue
            if not res.get("available") or res.get("spi_value") is None:
                continue

            ours.append(float(res["spi_value"]))
            theirs.append(float(ref.loc[ts]))
            n_samples_used.append(int(res.get("historical_samples_count") or 0))
            if classify_spi_gb(res["spi_value"]) == classify_spi_gb(float(ref.loc[ts])):
                band_hit += 1

        if len(ours) < 3:
            results.append(
                {
                    "region_id": region_id,
                    "scale": scale,
                    "error": f"可比月份过少（{len(ours)} 个），无法给出相关统计",
                }
            )
            continue

        a = np.asarray(ours)
        b = np.asarray(theirs)
        # spei 在某些月份可能给出常数（样本退化），此时相关无定义，据实记为 None
        r = float(stats.pearsonr(a, b)[0]) if np.std(a) > 0 and np.std(b) > 0 else None

        results.append(
            {
                "region_id": region_id,
                "scale": scale,
                "n_pairs": int(len(a)),
                "pearson_r": None if r is None or not np.isfinite(r) else round(r, 4),
                "mae": round(float(np.mean(np.abs(a - b))), 4),
                "max_diff": round(float(np.max(np.abs(a - b))), 4),
                "band_agreement": round(band_hit / float(len(a)), 4),
                "ours_n_samples_min": int(min(n_samples_used)),
                "ours_n_samples_max": int(max(n_samples_used)),
                "small_sample_months": int(
                    sum(1 for n in n_samples_used if n < MIN_TRUSTWORTHY_SAMPLES)
                ),
            }
        )

    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="用第三方 spei 库交叉校验本系统自研 Gamma-MLE SPI"
    )
    parser.add_argument("--region", help="只校验指定县域，默认全部 26 县")
    parser.add_argument(
        "--scale",
        type=int,
        action="append",
        help="累积尺度（月），可重复传入；默认 3 与 12",
    )
    parser.add_argument("--json", help="把结果另存为 JSON 的路径")
    args = parser.parse_args()

    scales = tuple(args.scale) if args.scale else (3, 12)

    if args.region:
        region_ids = [args.region]
    else:
        region_ids = [r["region_id"] for r in load_region_list()]

    print("=" * 96)
    print("  SPI 交叉校验：本系统自研 Gamma-MLE 实现  vs  第三方 spei（独立实现）")
    print(f"  县域 {len(region_ids)} 个 · 尺度 {list(scales)}")
    print("=" * 96)
    header = (
        f"{'县域':<16s} {'尺度':>4s} {'可比月':>6s} {'r':>8s} "
        f"{'MAE':>7s} {'最大差':>8s} {'分档一致':>8s} {'拟合样本数':>12s}"
    )
    print(header)
    print("-" * 96)

    all_rows: list[dict[str, Any]] = []
    for rid in region_ids:
        for row in cross_check_region(rid, scales):
            all_rows.append(row)
            if "error" in row:
                print(f"{rid:<16s} {row['scale']:>4d}  {row['error']}")
                continue
            r_txt = "  n/a" if row["pearson_r"] is None else f"{row['pearson_r']:>8.4f}"
            ns = f"{row['ours_n_samples_min']}~{row['ours_n_samples_max']}"
            print(
                f"{rid:<16s} {row['scale']:>4d} {row['n_pairs']:>6d} {r_txt} "
                f"{row['mae']:>7.4f} {row['max_diff']:>8.4f} "
                f"{row['band_agreement']:>8.4f} {ns:>12s}"
            )

    valid = [r for r in all_rows if "error" not in r]
    print("-" * 96)
    if valid:
        rs = [r["pearson_r"] for r in valid if r["pearson_r"] is not None]
        if rs:
            print(f"  相关系数 r      : 中位 {np.median(rs):.4f}，最小 {min(rs):.4f}")
        print(
            f"  平均绝对差 MAE : 中位 "
            f"{np.median([r['mae'] for r in valid]):.4f}"
        )
        print(
            f"  分档一致率      : 中位 "
            f"{np.median([r['band_agreement'] for r in valid]):.4f}"
        )

        thin = [r for r in valid if r["ours_n_samples_min"] < MIN_TRUSTWORTHY_SAMPLES]
        print()
        print("  ⚠ 样本量告警")
        print(
            f"    本系统 SPI 的 Gamma 参数由「历史同月累计降水」样本拟合，"
            f"ERA5 仅有 {len(build_monthly_series(region_ids[0])) // 12} 年，"
            f"且拟合窗口为 [起始年, 目标年)，因此目标年越早、样本越少。"
        )
        print(
            f"    {len(thin)}/{len(valid)} 个「县域×尺度」组合的最少样本数 < "
            f"{MIN_TRUSTWORTHY_SAMPLES}，其中最小 {min(r['ours_n_samples_min'] for r in valid)} 个样本。"
        )
        print(
            "    → 小样本下即便是本系统与 spei 都给出数值，该数值也不具备气候统计意义；"
        )
        print(
            "      相关数字在材料中引用时，必须与拟合样本数一并披露。"
        )

    if args.json:
        out_path = Path(args.json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(
                {
                    "scales": list(scales),
                    "min_trustworthy_samples": MIN_TRUSTWORTHY_SAMPLES,
                    "rows": all_rows,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"\n  已写出 JSON 报告: {out_path}")

    print("=" * 96)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
