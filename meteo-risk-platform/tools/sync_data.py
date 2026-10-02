"""
MeteoRiskPlatform - 数据内嵌打包工具
=============================================================================
把作品运行所需的全部数据从旧项目 **只读复制** 到 app/data/ 下，使
meteo-risk-platform/ 成为一个可独立交付、独立运行的作品包。

设计原则:
1. **只读**：本工具绝不写入、修改、删除旧项目 `yak-risk-platform/` 的任何文件。
2. **幂等**：重复执行结果一致；已存在且字节相同的文件跳过复制。
3. **显式清单**：只复制清单列出的文件，不做整目录拷贝，避免把
   CMFD NetCDF (约 1GB) 之类与运行无关的大文件一起打包。
4. **可校验**：复制完成后逐文件比对源与目标的字节数与 SHA-256，任一不符即报错退出。

用法:
    python tools/sync_data.py            # 复制 (默认)
    python tools/sync_data.py --verify   # 只校验，不复制
    python tools/sync_data.py --force    # 覆盖重拷

运行前提: 旧项目 yak-risk-platform/ 与 meteo-risk-platform/ 同级。
内嵌完成后，本作品即不再依赖旧项目。
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
OLD_PROJECT_ROOT = WORKSPACE_ROOT / "yak-risk-platform"
OLD_DATA_STORE = OLD_PROJECT_ROOT / "backend" / "data_store"
OLD_PUBLIC_DATA = OLD_PROJECT_ROOT / "public_data"

DEST_ROOT = PROJECT_ROOT / "app" / "data"
DEST_STORE = DEST_ROOT / "data_store"
DEST_PUBLIC = DEST_ROOT / "public_data"

# 数据底座表 (backend/data_store/*.json)
DATA_STORE_FILES = [
    "weather_data.json",          # 26 县 10 年逐月气象 (1.6M)
    "climate_era5.json",          # 26 县逐日 ERA5 再分析 (5.1M)
    "remote_sensing_data.json",   # MODIS NDVI / 积雪覆盖率 (2.0M)
    "npp_by_region.json",         # MOD17A3HGF 25 年 NPP (28K)
    "phenology_by_region.json",   # MCD12Q2 22 年物候 (148K)
    "business_subjects.json",     # 经营主体 (样例)
    "finance_credit.json",        # 绿色信贷 (样例)
    "real_labels_1500.json",      # 127 正例 + 1373 未标注 (636K)
    "risk_event_labels.json",     # 灾害事件标注底表 (140K)
]

# 公开地理数据 (public_data/*)
PUBLIC_DATA_FILES = [
    "region_list.csv",            # 26 县清单
    "region_bounds.json",         # 各县外接矩形
    "region_adcodes.json",        # 高德 adcode 映射 (可为空)
]

# 县域边界 GeoJSON (public_data/boundaries/*.geojson)
BOUNDARIES_SUBDIR = "boundaries"

# 说明: CMFD NetCDF (public_data/raw/tpdc/cmfd/*.nc, 约 1GB) **不在清单内**。
# 它只用于一次性构建 npp_features_2001_2025.json，而该缓存已随包提供，
# 运行期不读取 NetCDF；打包它既无必要，也会撞上 GitHub 单文件 100MB 上限。


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _same(src: Path, dst: Path) -> bool:
    """源与目标是否字节一致 (比字节数更可靠地判断是否需要重拷)。"""
    if not dst.exists() or src.stat().st_size != dst.stat().st_size:
        return False
    return _sha256(src) == _sha256(dst)


def _copy_one(src: Path, dst: Path, force: bool, verify_only: bool) -> str:
    if not src.exists():
        return f"MISSING_SRC  {src}"
    if verify_only:
        if not dst.exists():
            return f"MISSING_DST  {dst}"
        return "OK" if _same(src, dst) else f"MISMATCH     {src.name}"
    if not force and dst.exists() and _same(src, dst):
        return "SKIP"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    if not _same(src, dst):
        return f"COPY_FAILED  {src.name}"
    return "COPIED"


def main() -> int:
    ap = argparse.ArgumentParser(description="把旧项目数据只读复制进作品包 app/data/")
    ap.add_argument("--verify", action="store_true", help="只校验，不复制")
    ap.add_argument("--force", action="store_true", help="已存在也覆盖重拷")
    args = ap.parse_args()

    if not OLD_PROJECT_ROOT.exists():
        print(f"[sync] 错误: 未找到旧项目 {OLD_PROJECT_ROOT}")
        print("       本工具用于**首次内嵌**数据；若数据已内嵌，无需再运行。")
        return 2

    jobs: list[tuple[Path, Path]] = []
    for name in DATA_STORE_FILES:
        jobs.append((OLD_DATA_STORE / name, DEST_STORE / name))
    for name in PUBLIC_DATA_FILES:
        jobs.append((OLD_PUBLIC_DATA / name, DEST_PUBLIC / name))

    boundary_src = OLD_PUBLIC_DATA / BOUNDARIES_SUBDIR
    if boundary_src.is_dir():
        for gj in sorted(boundary_src.glob("*.geojson")):
            jobs.append((gj, DEST_PUBLIC / BOUNDARIES_SUBDIR / gj.name))

    stats: dict[str, int] = {}
    problems: list[str] = []
    total_bytes = 0
    for src, dst in jobs:
        result = _copy_one(src, dst, force=args.force, verify_only=args.verify)
        key = result.split()[0]
        stats[key] = stats.get(key, 0) + 1
        if key not in ("OK", "COPIED", "SKIP"):
            problems.append(result)
        elif key == "COPIED" and src.exists():
            total_bytes += src.stat().st_size

    mode = "校验" if args.verify else "同步"
    print(f"[sync] 数据{mode}完成 — 共 {len(jobs)} 个文件")
    for key in sorted(stats):
        print(f"       {key:<12} {stats[key]}")
    if not args.verify:
        print(f"       本次复制 {total_bytes / 1024 / 1024:.1f} MB → {DEST_ROOT}")

    if problems:
        print("\n[sync] 以下文件存在问题:")
        for p in problems:
            print(f"       {p}")
        return 1

    print("\n[sync] 全部文件字节一致，作品包已可独立运行。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
