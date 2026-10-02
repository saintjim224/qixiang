"""
MeteoRiskPlatform - 主入口与服务启动
=============================================================================
规范遵循:
- 独立服务，默认运行于端口 8001，与旧系统 8000 端口互不干扰;
- 挂载现代化 5 页气象决策前端.
"""

from __future__ import annotations

import os
from pathlib import Path
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from contextlib import asynccontextmanager
from app.core.config import FRONTEND_DIR
from app.api import overview, datasource, index, forecast, decision


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 预热全域 26 县风险评估与 GeoJSON 拓扑底座，确保前端首次首屏 < 50ms 极速加载
    try:
        overview.get_all_regions_feature_collection()
        overview.get_county_risks_overview()
        print("[main] 全域 26 县气象灾害底座与 GeoJSON 拓扑已预热完毕")
    except Exception as e:
        print(f"[main] 预热缓存出现非致命异常: {e}")
    yield


app = FastAPI(
    title="融天气象 - 高原多源时空融合气象灾害预警平台",
    description="第八届全球校园人工智能算法精英大赛 (AIC) · 算法主题赛（智慧气象）",
    version="1.0.0",
    lifespan=lifespan,
)

# 允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册核心 API 路由
app.include_router(overview.router)
app.include_router(datasource.router)
app.include_router(index.router)
app.include_router(forecast.router)
app.include_router(decision.router)


# 挂载前端静态资源
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


@app.get("/")
def serve_index() -> FileResponse:
    """提供前端 SPA 入口页面 (禁用强缓存确保即时刷新)."""
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="前端 index.html 尚未就绪")
    return FileResponse(index_file, headers=NO_CACHE_HEADERS)


@app.get("/{path:path}")
def serve_frontend_assets(path: str) -> FileResponse:
    """提供前端静态资源与路由."""
    target = FRONTEND_DIR / path
    if target.exists() and target.is_file():
        return FileResponse(target, headers=NO_CACHE_HEADERS)
    # 默认回退至 index.html
    return FileResponse(FRONTEND_DIR / "index.html", headers=NO_CACHE_HEADERS)


def run(host: str = "127.0.0.1", port: int = 8001) -> None:
    print(f"==================================================================")
    print(f"  融天气象平台已启动: http://{host}:{port}")
    print(f"  API 文档地址: http://{host}:{port}/docs")
    print(f"==================================================================")
    uvicorn.run("app.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    port_env = int(os.environ.get("METEO_PORT", "8001"))
    run(port=port_env)
