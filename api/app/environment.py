"""Environment switches that decide how safe the running API is."""
import logging
import os
import sys

logger = logging.getLogger("app.environment")

PLACEHOLDER = "change-me"
SECRETS_THAT_MUST_BE_CHANGED = ("POSTGRES_PASSWORD", "DATABASE_URL")


def app_env() -> str:
    return os.environ.get("APP_ENV", "")


def dev_header_allowed() -> bool:
    """The X-Dev-User header logs in as any user, so it needs two switches, not one copied APP_ENV."""
    return app_env() == "development" and os.environ.get("ALLOW_DEV_HEADER") == "1"


def cookie_secure() -> bool:
    """COOKIE_SECURE=0 or 1 wins; without it the cookie is Secure in production only."""
    explicit = os.environ.get("COOKIE_SECURE")
    if explicit is not None:
        return explicit == "1"
    return app_env() == "production"


def require_development(script_name: str) -> None:
    """Exit with a message unless APP_ENV=development. Dev seed scripts call this first."""
    if app_env() != "development":
        sys.exit(f"{script_name} runs only when APP_ENV=development")


def unsafe_settings() -> list[str]:
    """Reasons the API must not start outside development. Empty in development."""
    if app_env() == "development":
        return []
    problems = []
    if os.environ.get("ALLOW_DEV_HEADER") == "1":
        problems.append("ALLOW_DEV_HEADER=1 is only for APP_ENV=development")
    for name in SECRETS_THAT_MUST_BE_CHANGED:
        if PLACEHOLDER in os.environ.get(name, PLACEHOLDER):
            problems.append(f"{name} is empty or still holds '{PLACEHOLDER}'")
    return problems


def check_startup_environment() -> None:
    problems = unsafe_settings()
    if problems:
        raise RuntimeError("Unsafe settings for APP_ENV=" + repr(app_env()) + ": " + "; ".join(problems))
    if dev_header_allowed():
        logger.warning("X-Dev-User header login is ON (APP_ENV=development, ALLOW_DEV_HEADER=1)")
