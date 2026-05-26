from fastapi import APIRouter
from models import ApiResponse, ConfigUpdate

router = APIRouter()


@router.get("", response_model=ApiResponse)
async def get_config():
    from services.crypto_service import get_all_config
    return ApiResponse(data=get_all_config())


@router.put("", response_model=ApiResponse)
async def update_config(req: ConfigUpdate):
    from services.crypto_service import update_config
    update_config(req.model_dump(exclude_none=True))
    return ApiResponse()
