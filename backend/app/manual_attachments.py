import base64
import binascii
import hashlib
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator

from app.database import get_data_dir

MAX_ATTACHMENT_BYTES = 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {"text/plain", "image/png", "image/jpeg", "application/pdf"}


class AttachmentCommand(BaseModel):
    filename: str = Field(min_length=1, max_length=120)
    content_type: str
    content_base64: str

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if Path(value).name != value or value in {".", ".."}:
            raise ValueError("附件文件名无效")
        return value

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, value: str) -> str:
        if value not in ALLOWED_ATTACHMENT_TYPES:
            raise ValueError("附件类型不受支持")
        return value


def save_manual_attachment(run_id: int, result_id: int, command: AttachmentCommand) -> dict[str, str | int]:
    """严格解码并保存人工检查的小型附件，只向 API 暴露安全元数据。"""
    try:
        content = base64.b64decode(command.content_base64, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(status_code=422, detail="附件内容不是有效 Base64") from error
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="附件不能超过 1 MiB")

    attachment_dir = get_data_dir() / "runs" / str(run_id) / "manual-attachments"
    attachment_dir.mkdir(parents=True, exist_ok=True)
    stored_path = attachment_dir / f"{result_id}-{command.filename}"
    stored_path.write_bytes(content)
    return {
        "filename": command.filename,
        "content_type": command.content_type,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def get_manual_attachment_path(run_id: int, result_id: int, filename: str) -> Path:
    """按已持久化元数据构造附件路径，不接受调用方提供的任意路径。"""
    return get_data_dir() / "runs" / str(run_id) / "manual-attachments" / f"{result_id}-{filename}"
