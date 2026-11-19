"""Domain errors raised by services. main.py turns them into the HTTP response."""
from typing import Any


class ServiceError(Exception):
    def __init__(self, status: int, message: Any):
        super().__init__(message)
        self.status = status
        self.message = message


class NotFound(ServiceError):
    def __init__(self, message: Any):
        super().__init__(404, message)


class Conflict(ServiceError):
    def __init__(self, message: Any):
        super().__init__(409, message)


class Forbidden(ServiceError):
    def __init__(self, message: Any):
        super().__init__(403, message)


class Invalid(ServiceError):
    def __init__(self, message: Any):
        super().__init__(422, message)
