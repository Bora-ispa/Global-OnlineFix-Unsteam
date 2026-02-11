from typing import Optional, Dict, Any, Tuple

# PluginUtils import
try:
    import PluginUtils
    logger = PluginUtils.Logger()
except ImportError as e:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger('ispa.http_client')
    logger.error(f"PluginUtils import hatası: {e}")

try:
    import httpx
    from httpx import HTTPStatusError, RequestError, Response
    HTTPX_AVAILABLE = True
except ImportError:
    httpx = None
    HTTPStatusError = None
    RequestError = None
    Response = None
    HTTPX_AVAILABLE = False

# logger zaten yukarda tanımlandı
# logger = PluginUtils.Logger()  # Bu satırı kaldır

PLUGIN_UA = 'ispa-plugin/1.0.0 (Millennium)'
WAF_HEADER_NAME = 'X-IspaUA'
WAF_HEADER_VALUE = 'ispa-plugin-1'

BASE_HEADERS = {
    'Accept': 'application/json',
    'X-Requested-With': 'ispa-Plugin',
    'Origin': 'https://store.steampowered.com',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
}

class HTTPClient:
    def __init__(self, timeout: int = 30):
        self._client = None
        self._timeout = timeout

    def _ensure_client(self):
        if not HTTPX_AVAILABLE:
            raise Exception("httpx is not available. pip install httpx")
        if self._client is None:
            self._client = httpx.Client(timeout=self._timeout, follow_redirects=True)
        return self._client

    def _build_headers(self, extra: Optional[Dict[str, str]] = None, auth_token: Optional[str] = None) -> Dict[str, str]:
        headers = BASE_HEADERS.copy()
        headers['User-Agent'] = PLUGIN_UA
        headers[WAF_HEADER_NAME] = WAF_HEADER_VALUE
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'
        if extra:
            headers.update(extra)
        return headers

    def _success_json(self, response: Response) -> Dict[str, Any]:
        # Tip kontrolü - Response objesi olmalı
        if response is None:
            logger.error('HTTPClient: _success_json called with None response')
            return {'success': False, 'error': 'Response nesnesi None', 'status_code': None}
        
        # httpx.Response tipinde olmadığı durumlar için kontrol
        if HTTPX_AVAILABLE and not isinstance(response, Response):
            logger.error(f'HTTPClient: Expected Response object, got {type(response).__name__}')
            return {'success': False, 'error': f'Geçersiz response tipi: {type(response).__name__}', 'status_code': None}
        
        try:
            data = response.json()
        except (ValueError, AttributeError) as e:
            # JSON parse hatası veya response.json() metodu yoksa text kullan
            logger.warning(f'HTTPClient: JSON parse failed, using text: {e}')
            data = response.text if hasattr(response, 'text') else str(response)
        except Exception as e:
            logger.error(f'HTTPClient: Unexpected error in _success_json: {e}')
            data = str(response)
        
        status_code = getattr(response, 'status_code', None)
        return {'success': True, 'data': data, 'status_code': status_code}

    def _error_dict(self, url: str, e: Exception) -> Dict[str, Any]:
        if HTTPX_AVAILABLE and HTTPStatusError is not None and isinstance(e, HTTPStatusError):
            error_msg = f"HTTP {e.response.status_code}: {e.response.text if e.response else 'No response'}"
            logger.error(f'HTTPClient: {url} -> {error_msg}')
            return {'success': False, 'error': error_msg, 'status_code': e.response.status_code if e.response else None}
        elif HTTPX_AVAILABLE and RequestError is not None and isinstance(e, RequestError):
            error_msg = f"İstek hatası: {str(e)}"
            logger.error(f'HTTPClient: {url} -> {error_msg}')
            return {'success': False, 'error': error_msg}
        else:
            error_msg = f"Beklenmeyen hata: {str(e)}"
            logger.error(f'HTTPClient: {url} -> {error_msg}')
            return {'success': False, 'error': error_msg}

    def get(self, url: str, params: Optional[Dict[str, Any]] = None, auth_token: Optional[str] = None) -> Dict[str, Any]:
        try:
            client = self._ensure_client()
            headers = self._build_headers(auth_token=auth_token)
            resp = client.get(url, params=params or {}, headers=headers)
            resp.raise_for_status()
            return self._success_json(resp)
        except Exception as e:
            return self._error_dict(url, e)

    def get_binary(self, url: str, params: Optional[Dict[str, Any]] = None, auth_token: Optional[str] = None) -> Dict[str, Any]:
        try:
            client = self._ensure_client()
            headers = self._build_headers(auth_token=auth_token)
            resp = client.get(url, params=params or {}, headers=headers)
            resp.raise_for_status()
            return {'success': True, 'data': resp.content, 'status_code': resp.status_code}
        except Exception as e:
            return self._error_dict(url, e)

    def raw_get(self, url: str, params: Optional[Dict[str, Any]] = None, auth_token: Optional[str] = None,
                extra_headers: Optional[Dict[str, str]] = None) -> Tuple[int, Dict[str, str], bytes]:
        client = self._ensure_client()
        headers = self._build_headers(extra=extra_headers, auth_token=auth_token)
        resp = client.get(url, params=params or {}, headers=headers)
        return resp.status_code, {k: v for k, v in resp.headers.items()}, resp.content

    def get_with_headers(self, url: str, params: Optional[Dict[str, Any]] = None,
                         auth_token: Optional[str] = None,
                         extra_headers: Optional[Dict[str, str]] = None) -> Tuple[bytes, Dict[str, str], int]:
        status, headers, content = self.raw_get(url, params=params, auth_token=auth_token, extra_headers=extra_headers)
        return content, headers, status

    def stream_get(self, url: str, **kwargs):
        client = self._ensure_client()
        headers = self._build_headers()
        return client.stream('GET', url, headers=headers, **kwargs)

    def post(self, url: str, data: Optional[Dict[str, Any]] = None, auth_token: Optional[str] = None) -> Dict[str, Any]:
        try:
            client = self._ensure_client()
            headers = self._build_headers(auth_token=auth_token)
            if data:
                headers['Content-Type'] = 'application/json'
            resp = client.post(url, json=data or {}, headers=headers)
            resp.raise_for_status()
            return {'success': True, 'data': resp.text, 'status_code': resp.status_code}
        except Exception as e:
            return self._error_dict(url, e)

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass

_global_client: Optional[HTTPClient] = None

def get_global_client() -> HTTPClient:
    global _global_client
    if _global_client is None:
        _global_client = HTTPClient()
    return _global_client

def close_global_client() -> None:
    global _global_client
    if _global_client is not None:
        _global_client.close()
        _global_client = None
