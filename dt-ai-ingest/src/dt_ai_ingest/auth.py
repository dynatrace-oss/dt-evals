"""Dynatrace API authentication — single access token for both endpoints."""

from __future__ import annotations

# Classic DT API tokens always start with one of these prefixes.
_CLASSIC_TOKEN_PREFIXES = ("dt0c01.", "dt0s01.", "dt0e01.", "dt0p01.")


def is_classic_token(access_token: str) -> bool:
    """Return ``True`` if *access_token* is a classic Dynatrace API token."""
    return any(access_token.startswith(p) for p in _CLASSIC_TOKEN_PREFIXES)


def make_auth_header(access_token: str) -> str:
    """Return the correct ``Authorization`` header value for *access_token*.

    - Classic tokens (``dt0c01.*``, ``dt0s01.*``, …) → ``Api-Token <token>``
    - Bearer / JWT tokens → ``Bearer <token>``
    """
    if is_classic_token(access_token):
        return f"Api-Token {access_token}"
    return f"Bearer {access_token}"
