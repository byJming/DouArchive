from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from models import ExportRequest

router = APIRouter()


@router.post("")
async def export_data(req: ExportRequest):
    from services.export_service import export_data
    file_stream, filename, media_type = export_data(req)
    return StreamingResponse(
        file_stream,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
