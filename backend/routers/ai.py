from fastapi import APIRouter
from models import ApiResponse, AIAnalyzeRequest

router = APIRouter()


@router.post("/analyze", response_model=ApiResponse)
async def analyze(req: AIAnalyzeRequest):
    from services.ai_service import generate_report
    result = await generate_report(req)
    if "error" in result:
        return ApiResponse(code=50000, message=result["error"])
    return ApiResponse(data=result)


@router.get("/reports", response_model=ApiResponse)
async def list_reports():
    from services.ai_service import list_reports
    return ApiResponse(data=list_reports())


@router.get("/reports/{report_id}", response_model=ApiResponse)
async def get_report(report_id: str):
    from services.ai_service import get_report
    report = get_report(report_id)
    if not report:
        return ApiResponse(code=40401, message="报告不存在")
    return ApiResponse(data=report)
