import json
from typing import Dict, Any

# PluginUtils import
try:
    import PluginUtils
    logger = PluginUtils.Logger()
except ImportError as e:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger('ispa.api_manager')
    logger.error(f"PluginUtils import hatası: {e}")

from http_client import get_global_client

# logger zaten yukarda tanımlandı
# logger = PluginUtils.Logger()  # Bu satırı kaldır

HOST_BASE = 'https://kernelos.org'
DOWNLOAD_GEN_URL = HOST_BASE + '/games/download.php?gen=1&id={appid}'

class APIManager:
    def __init__(self, backend_path: str):
        self.backend_path = backend_path
        self._api_key = None

    def set_api_key(self, api_key: str):
        self._api_key = api_key

    def get_api_key(self):
        return getattr(self, '_api_key', None)

    def _request_signed_link(self, appid: int) -> Dict[str, Any]:
        try:
            client = get_global_client()
            url = DOWNLOAD_GEN_URL.format(appid=str(appid))
            res = client.get(url)
            if not res.get('success'):
                return {'success': False, 'error': res.get('error', 'İstek başarısız')}
            data = res.get('data')
            if isinstance(data, (bytes, bytearray)):
                # strict mode kullan - bozuk data yakalansın
                try:
                    data = data.decode('utf-8', errors='strict')
                except UnicodeDecodeError as e:
                    logger.error(f'APIManager: UTF-8 decode hatası: {e}')
                    return {'success': False, 'error': 'Yanıt geçersiz UTF-8 içeriyor'}
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except json.JSONDecodeError as e:
                    logger.error(f'APIManager: JSON parse hatası: {e}')
                    return {'success': False, 'error': 'Generator tarafından geçersiz JSON döndürüldü'}
            if not isinstance(data, dict) or 'url' not in data:
                return {'success': False, 'error': 'Yanıt bozuk (url yok)'}
            dl = data['url']
            if isinstance(dl, str) and dl.startswith('/'):
                dl = HOST_BASE + dl
            return {'success': True, 'url': dl, 'expires_at': data.get('expires_at')}
        except Exception as e:
            logger.error(f'APIManager: _request_signed_link hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def get_signed_download_url(self, appid: int) -> Dict[str, Any]:
        return self._request_signed_link(appid)

    def check_availability(self, appid: int, endpoint: str = "") -> Dict[str, Any]:
        try:
            res = self._request_signed_link(appid)
            if res.get('success') and res.get('url'):
                ret = {'success': True, 'available': True, 'endpoint': (endpoint or 'ispa')}
                if 'expires_at' in res:
                    ret['expires_at'] = res['expires_at']
                return ret
            return {'success': True, 'available': False, 'endpoint': (endpoint or 'ispa')}
        except Exception as e:
            logger.error(f'APIManager: Erişilebilirlik kontrolü hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def fetch_available_endpoints(self) -> Dict[str, Any]:
        try:
            return {'success': True, 'endpoints': ['ispa']}
        except Exception as e:
            logger.error(f'APIManager: Uç noktalar alınamadı: {e}')
            return {'success': False, 'error': str(e)}

    def get_download_endpoints(self) -> list:
        try:
            res = self.fetch_available_endpoints()
            if res.get('success') and res.get('endpoints'):
                return res['endpoints']
        except Exception as e:
            logger.warn(f'APIManager: Uç noktalar alınamadı: {e}')
        return ['ispa']

    def get_user_id(self) -> Dict[str, Any]:
        return {'success': False, 'error': "ispa'da desteklenmiyor"}
