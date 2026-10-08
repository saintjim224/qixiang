"""
MeteoRiskPlatform - 作品名称与品牌常量的唯一来源
=============================================================================
作品名称此前在 6 处各写各的:

    FastAPI title      : 融天气象 - 高原多源时空融合气象灾害预警平台
    /api/overview/status: 融天气象 - 高原多源时空融合气象灾害预警平台
    run.sh             : 面向青藏高原牧区的高原多源时空融合气象灾害预警与草畜平衡决策平台
    start.bat (标题栏)  : 高原草畜气象风险智能预警与决策平台
    frontend <title>   : 高原草畜气象风险智能预警与决策平台
    frontend <h1>      : 高原草畜气象风险智能预警与决策平台

同一个作品出现三个不同名字，启动脚本、浏览器标签页和 API 文档里
看到的标题都对不上。统一为下面这一个常量。
Python 侧一律 `from app.core.branding import PRODUCT_NAME`，不得再写字符串字面量。
（run.sh / start.bat / index.html 是脚本与静态页，无法 import，只能保持字面量，
  改动时请同步这三处。）
"""

from __future__ import annotations

PRODUCT_NAME = "融天气象 - 高原多源时空融合气象灾害预警平台"
PRODUCT_NAME_EN = "MeteoRiskPlatform"
PRODUCT_DESCRIPTION = (
    "面向青藏高原牧区的多源时空融合气象灾害预警与草畜平衡决策服务："
    "融合 ERA5 再分析、MODIS 生态与地面事件标签，提供风险指数计算、"
    "灾害趋势预测、承灾体脆弱性评估与应急处置测算能力。"
)
