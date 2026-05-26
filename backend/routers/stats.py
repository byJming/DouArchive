from fastapi import APIRouter
from typing import Optional
from models import ApiResponse

router = APIRouter()


@router.get("/overview", response_model=ApiResponse)
async def stats_overview():
    from services.stats_service import get_overview
    return ApiResponse(data=get_overview())


@router.get("/by-year", response_model=ApiResponse)
async def stats_by_year(media_type: Optional[str] = None):
    from services.stats_service import get_by_year
    return ApiResponse(data=get_by_year(media_type))


@router.get("/by-score", response_model=ApiResponse)
async def stats_by_score(media_type: Optional[str] = None):
    from services.stats_service import get_by_score
    return ApiResponse(data=get_by_score(media_type))


@router.get("/by-month", response_model=ApiResponse)
async def stats_by_month(media_type: Optional[str] = None):
    from services.stats_service import get_by_month
    return ApiResponse(data=get_by_month(media_type))


@router.get("/by-tag", response_model=ApiResponse)
async def stats_by_tag(media_type: Optional[str] = None, limit: int = 20):
    from services.stats_service import get_by_tag
    return ApiResponse(data=get_by_tag(media_type, limit))


@router.get("/by-creator", response_model=ApiResponse)
async def stats_by_creator(media_type: Optional[str] = None, limit: int = 20):
    from services.stats_service import get_by_creator
    return ApiResponse(data=get_by_creator(media_type, limit))

@router.get("/by-day", response_model=ApiResponse)
async def stats_by_day(media_type: Optional[str] = None, year: Optional[str] = None):
    from services.stats_service import get_by_day
    return ApiResponse(data=get_by_day(media_type, year))
