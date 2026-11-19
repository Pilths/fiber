"""Read an uploaded file for the ingest routers: extension check and size limit."""
from fastapi import UploadFile

from app.errors import Invalid, ServiceError

MAX_BYTES = 20 * 1024 * 1024


def read_upload(file: UploadFile, extension: str) -> tuple[str, bytes]:
    name = file.filename or ""
    if not name.lower().endswith(extension):
        raise Invalid(f"Only {extension} files are accepted")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ServiceError(413, "File is larger than 20 MB")
    return name, data
