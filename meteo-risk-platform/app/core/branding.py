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

同一个作品出现三个不同名字，评委在启动脚本、浏览器标签页和 API 文档里
看到的标题都对不上。按规格书 §9 Q1 的定稿，统一为下面这一个常量。
Python 侧一律 `from app.core.branding import PRODUCT_NAME`，不得再写字符串字面量。
（run.sh / start.bat / index.html 是脚本与静态页，无法 import，只能保持字面量，
  改动时请同步这三处。）
"""

from __future__ import annotations

PRODUCT_NAME = "融天气象 - 高原多源时空融合气象灾害预警平台"
PRODUCT_NAME_EN = "MeteoRiskPlatform"
COMPETITION = "第八届全球校园人工智能算法精英大赛 (AIC) · 算法主题赛（智慧气象）"
COMPETITION_TRACK = "赛题方向二：气象赋能行业应用"
