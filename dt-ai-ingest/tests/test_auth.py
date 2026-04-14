"""Tests for dt_ai_ingest.auth."""

from dt_ai_ingest.auth import is_classic_token, make_auth_header


class TestIsClassicToken:
    def test_dt0c01(self):
        assert is_classic_token("dt0c01.abc.xyz") is True

    def test_dt0s01(self):
        assert is_classic_token("dt0s01.abc.xyz") is True

    def test_dt0e01(self):
        assert is_classic_token("dt0e01.abc.xyz") is True

    def test_dt0p01(self):
        assert is_classic_token("dt0p01.abc.xyz") is True

    def test_bearer_jwt(self):
        assert is_classic_token("eyJhbGciOiJSUzI1NiJ9.xxx") is False

    def test_unknown_prefix(self):
        assert is_classic_token("some-other-token") is False


class TestMakeAuthHeader:
    def test_classic_api_token(self):
        assert make_auth_header("dt0c01.abc.xyz") == "Api-Token dt0c01.abc.xyz"

    def test_classic_saas_token(self):
        assert make_auth_header("dt0s01.abc.xyz") == "Api-Token dt0s01.abc.xyz"

    def test_classic_env_token(self):
        assert make_auth_header("dt0e01.abc.xyz") == "Api-Token dt0e01.abc.xyz"

    def test_classic_platform_token(self):
        assert make_auth_header("dt0p01.abc.xyz") == "Api-Token dt0p01.abc.xyz"

    def test_bearer_jwt(self):
        assert make_auth_header("eyJhbGciOiJSUzI1NiJ9.xxx") == "Bearer eyJhbGciOiJSUzI1NiJ9.xxx"

    def test_bearer_unknown_prefix(self):
        assert make_auth_header("some-other-token") == "Bearer some-other-token"
