from fastapi import APIRouter, Query
from typing import Optional, List
from models import SyncRequest, ApiResponse, SyncResponse

router = APIRouter()


@router.post("/sync", response_model=ApiResponse)
async def sync_media(req: SyncRequest):
    from services.media_service import sync_items
    result = sync_items(req.items)
    return ApiResponse(data=result)


@router.get("", response_model=ApiResponse)
async def list_media(
    media_type: Optional[str] = None,
    mark_status: Optional[str] = None,
    score_min: Optional[float] = None,
    score_max: Optional[float] = None,
    keyword: Optional[str] = None,
    tag: Optional[str] = None,
    sort: str = "mark_time",
    order: str = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    from services.media_service import query_media
    result = query_media(
        media_type=media_type, mark_status=mark_status,
        score_min=score_min, score_max=score_max,
        keyword=keyword, tag=tag, sort=sort, order=order,
        page=page, page_size=page_size,
    )
    return ApiResponse(data=result)


@router.get("/{item_id}", response_model=ApiResponse)
async def get_media(item_id: int):
    from services.media_service import get_item
    item = get_item(item_id)
    if not item:
        return ApiResponse(code=40401, message="条目不存在")
    return ApiResponse(data=item)


@router.put("/{item_id}", response_model=ApiResponse)
async def update_media(item_id: int, data: dict):
    from services.media_service import update_item
    ok = update_item(item_id, data)
    if not ok:
        return ApiResponse(code=40401, message="更新失败")
    return ApiResponse()


@router.delete("/{item_id}", response_model=ApiResponse)
async def delete_media(item_id: int):
    from services.media_service import delete_item
    ok = delete_item(item_id)
    if not ok:
        return ApiResponse(code=40401, message="删除失败")
    return ApiResponse()


@router.delete("/by-douban/{douban_id}", response_model=ApiResponse)
async def delete_media_by_douban(douban_id: str, media_type: str = Query(...)):
    """通过豆瓣 ID + 媒体类型删除单条数据"""
    from services.media_service import delete_by_douban_id
    ok = delete_by_douban_id(douban_id, media_type)
    if not ok:
        return ApiResponse(code=40401, message="条目不存在")
    return ApiResponse()


@router.post("/batch-delete", response_model=ApiResponse)
async def batch_delete_media(data: dict):
    """批量删除：支持 {"ids": [1,2,3]} 或 {"douban_ids": [{"douban_id":"xxx","media_type":"movie"}]}"""
    from services.media_service import batch_delete
    result = batch_delete(data)
    return ApiResponse(data=result)

