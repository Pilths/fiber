"""Startup guard and the switches behind the X-Dev-User header and the cookie flag."""
import pytest
from app.environment import check_startup_environment, cookie_secure, dev_header_allowed, unsafe_settings

SAFE_SECRETS = {"POSTGRES_PASSWORD": "a-long-random-value", "DATABASE_URL": "postgresql+psycopg://fiber:a-long-random-value@db/fiber"}


def set_env(monkeypatch, **values):
    for name in ("APP_ENV", "ALLOW_DEV_HEADER", "COOKIE_SECURE", "POSTGRES_PASSWORD", "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def test_header_needs_both_switches(monkeypatch):
    set_env(monkeypatch, APP_ENV="development")
    assert dev_header_allowed() is False
    set_env(monkeypatch, APP_ENV="development", ALLOW_DEV_HEADER="1")
    assert dev_header_allowed() is True
    set_env(monkeypatch, APP_ENV="production", ALLOW_DEV_HEADER="1")
    assert dev_header_allowed() is False


def test_cookie_secure_defaults_to_production_and_can_be_set(monkeypatch):
    set_env(monkeypatch, APP_ENV="development")
    assert cookie_secure() is False
    set_env(monkeypatch, APP_ENV="production")
    assert cookie_secure() is True
    set_env(monkeypatch, APP_ENV="production", COOKIE_SECURE="0")
    assert cookie_secure() is False


def test_development_always_starts(monkeypatch):
    set_env(monkeypatch, APP_ENV="development", POSTGRES_PASSWORD="change-me")
    assert unsafe_settings() == []
    check_startup_environment()


def test_production_refuses_placeholder_secrets_and_dev_header(monkeypatch):
    set_env(monkeypatch, APP_ENV="production", ALLOW_DEV_HEADER="1", POSTGRES_PASSWORD="change-me")
    problems = unsafe_settings()
    assert len(problems) == 3
    with pytest.raises(RuntimeError, match="ALLOW_DEV_HEADER"):
        check_startup_environment()


def test_unset_app_env_is_not_development(monkeypatch):
    set_env(monkeypatch, **SAFE_SECRETS)
    assert unsafe_settings() == []
    set_env(monkeypatch)
    assert unsafe_settings() != []


def test_production_with_real_secrets_starts(monkeypatch):
    set_env(monkeypatch, APP_ENV="production", **SAFE_SECRETS)
    check_startup_environment()
