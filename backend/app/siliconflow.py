"""多服务商 OpenAI 兼容适配层公共入口；保留既有导入路径。"""

import time
from collections.abc import Callable

from app.ai_provider_core import (
    PROVIDER_ENDPOINTS,
    PROVIDER_MODEL_ENDPOINTS,
    CatalogTransport,
    ModelErrorKind,
    SiliconFlowError,
    Transport,
    _default_catalog_transport,
    _default_transport,
    _network_error_kind,
    configured_timeout,
    endpoint_host,
)
from app.provider_adapter import ProviderAdapter

__all__ = [
    "PROVIDER_ENDPOINTS",
    "PROVIDER_MODEL_ENDPOINTS",
    "CatalogTransport",
    "ModelErrorKind",
    "ProviderAdapter",
    "SiliconFlowAdapter",
    "SiliconFlowError",
    "Transport",
    "_network_error_kind",
    "configured_timeout",
    "endpoint_host",
]


class SiliconFlowAdapter(ProviderAdapter):
    """保留 RC1 公共类名，兼容已有调用方和测试 seam。"""

    def __init__(
        self,
        transport: Transport = _default_transport,
        catalog_transport: CatalogTransport = _default_catalog_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
        model_endpoint: str | None = None,
        network_mode: str = "system_proxy",
        **kwargs: object,
    ) -> None:
        super().__init__(
            "siliconflow",
            endpoint=endpoint,
            transport=transport,
            catalog_transport=catalog_transport,
            model_endpoint=model_endpoint,
            sleep=sleep,
            network_mode=network_mode,
            **kwargs,
        )


class DeepSeekAdapter(ProviderAdapter):
    def __init__(
        self,
        transport: Transport = _default_transport,
        catalog_transport: CatalogTransport = _default_catalog_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
        model_endpoint: str | None = None,
        network_mode: str = "system_proxy",
        **kwargs: object,
    ) -> None:
        super().__init__(
            "deepseek",
            endpoint=endpoint,
            transport=transport,
            catalog_transport=catalog_transport,
            model_endpoint=model_endpoint,
            sleep=sleep,
            network_mode=network_mode,
            **kwargs,
        )


class KimiAdapter(ProviderAdapter):
    def __init__(
        self,
        transport: Transport = _default_transport,
        catalog_transport: CatalogTransport = _default_catalog_transport,
        sleep: Callable[[float], None] = time.sleep,
        endpoint: str | None = None,
        model_endpoint: str | None = None,
        network_mode: str = "system_proxy",
        **kwargs: object,
    ) -> None:
        super().__init__(
            "kimi",
            endpoint=endpoint,
            transport=transport,
            catalog_transport=catalog_transport,
            model_endpoint=model_endpoint,
            sleep=sleep,
            network_mode=network_mode,
            **kwargs,
        )
