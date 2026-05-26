from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


class MediaItem(BaseModel):
    douban_id: str
    media_type: str = Field(..., pattern="^(movie|book|music)$")
    title: str = ""
    alt_title: str = ""
    score: Optional[float] = Field(None, ge=0, le=5)
    mark_status: str = Field(..., pattern="^(wish|do|collect)$")
    mark_time: Optional[str] = None
    creator: str = ""
    comment: str = ""
    tags: List[str] = []
    douban_url: str
    cover: str = ""
    intro_raw: str = ""


class SyncRequest(BaseModel):
    items: List[MediaItem]


class SyncResponse(BaseModel):
    total: int
    created: int
    updated: int
    skipped: int


class MediaQuery(BaseModel):
    media_type: Optional[str] = None
    mark_status: Optional[str] = None
    score_min: Optional[float] = None
    score_max: Optional[float] = None
    keyword: Optional[str] = None
    tag: Optional[str] = None
    sort: str = "mark_time"
    order: str = "desc"
    page: int = 1
    page_size: int = 30


class ApiResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: Optional[Any] = None


class AIAnalyzeRequest(BaseModel):
    prompt_type: str = Field(..., pattern="^(preference|recommend|custom)$")
    media_type: Optional[str] = None
    custom_prompt: str = ""
    model: Optional[str] = None


class ExportRequest(BaseModel):
    format: str = Field("xlsx", pattern="^(xlsx|json|csv)$")
    media_type: Optional[str] = None
    mark_status: Optional[str] = None
    fields: List[str] = ["title", "score", "mark_time", "tags", "comment"]


class ConfigUpdate(BaseModel):
    ai_provider: Optional[str] = None
    ai_api_key: Optional[str] = None
    ai_base_url: Optional[str] = None
    ai_model: Optional[str] = None
    ai_max_tokens: Optional[int] = None
    export_default_format: Optional[str] = None
    scrape_delay_min: Optional[int] = None
    scrape_delay_max: Optional[int] = None
