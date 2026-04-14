"""Unit tests for dt_ai_ingest.langfuse.tracing."""

from unittest.mock import MagicMock, patch

from dt_ai_ingest.langfuse.tracing import configure_dynatrace_tracing


class TestConfigureDynatraceTracing:
    def test_delegates_to_configure_tracing(self):
        """Verify it's a thin wrapper around _otel.configure_tracing."""
        with patch("dt_ai_ingest.langfuse.tracing.configure_tracing") as mock_ct:
            mock_provider = MagicMock()
            mock_ct.return_value = mock_provider

            result = configure_dynatrace_tracing(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
            )

            mock_ct.assert_called_once_with(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
                service_name="langfuse-eval",
            )
            assert result is mock_provider

    def test_custom_service_name(self):
        """Verify custom service_name is forwarded."""
        with patch("dt_ai_ingest.langfuse.tracing.configure_tracing") as mock_ct:
            mock_ct.return_value = MagicMock()

            configure_dynatrace_tracing(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
                service_name="my-langfuse-app",
            )

            mock_ct.assert_called_once_with(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
                service_name="my-langfuse-app",
            )

    def test_default_service_name_is_langfuse_eval(self):
        """Default service_name is 'langfuse-eval' (not 'mlflow-eval')."""
        with patch("dt_ai_ingest.langfuse.tracing.configure_tracing") as mock_ct:
            mock_ct.return_value = MagicMock()

            configure_dynatrace_tracing(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
            )

            _, kwargs = mock_ct.call_args
            assert kwargs["service_name"] == "langfuse-eval"
