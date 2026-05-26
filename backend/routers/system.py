from fastapi import APIRouter
from models import ApiResponse
from pathlib import Path

router = APIRouter()

VERSION = "1.0.0"


@router.get("/health", response_model=ApiResponse)
async def health():
    from database import DB_PATH, get_connection
    conn = get_connection()
    count = conn.execute("SELECT COUNT(*) FROM media").fetchone()[0]
    conn.close()
    db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    return ApiResponse(data={
        "status": "ok",
        "version": VERSION,
        "db_size": db_size,
        "media_count": count,
    })


@router.get("/check-update", response_model=ApiResponse)
async def check_update():
    return ApiResponse(data={"latest_version": VERSION, "has_update": False})
