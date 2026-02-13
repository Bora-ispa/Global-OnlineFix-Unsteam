# Critical imports - Millennium plugin ortamında olmalı
try:
    import Millennium
except ImportError as e:
    print(f"HATA: Millennium modülü bulunamadı. Bu plugin Millennium ortamında çalışmalı. {e}")
    raise

try:
    import PluginUtils
    logger = PluginUtils.Logger()
except ImportError as e:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger('ispa')
    logger.error(f"PluginUtils import hatası: {e}")

import json
import os
import subprocess
import platform
import time

from http_client import close_global_client
from api_manager import APIManager
from ispa import IspaManager
from steam_utils import (
    detect_steam_install_path,
    has_lua_for_app
)
from steam_verification import SteamVerification

# Steam doğrulama örneği oluştur
_steam_verification = None

def get_steam_verification():
    global _steam_verification
    if _steam_verification is None:
        try:
            _steam_verification = SteamVerification()
        except Exception as e:
            logger.warn(f"SteamVerification başlatılamadı: {e}")
    return _steam_verification

# logger zaten yukarda tanımlandı, tekrar tanımlama
# logger = PluginUtils.Logger()  # Bu satırı kaldır

def GetPluginDir():
    current_file = os.path.realpath(__file__)
    if current_file.endswith('/main.py/main.py') or current_file.endswith('\\main.py\\main.py'):
        current_file = current_file[:-8]
    elif current_file.endswith('/main.py') or current_file.endswith('\\main.py'):
        current_file = current_file[:-8]
    backend_dir = os.path.dirname(current_file) if current_file.endswith('main.py') else current_file
    return os.path.dirname(backend_dir)

class Logger:
    @staticmethod
    def log(message: str) -> None: logger.log(message)
    @staticmethod
    def warn(message: str) -> None: logger.warn(message)
    @staticmethod
    def error(message: str) -> None: logger.error(message)

class Plugin:
    def __init__(self):
        self.plugin_dir = GetPluginDir()
        self.backend_path = os.path.join(self.plugin_dir, 'backend')
        self.api_manager = APIManager(self.backend_path)
        self.ispa_manager = IspaManager(self.backend_path)
        self._api_key = None
        self._injected = False

    def _inject_webkit_files(self):
        if self._injected:
            logger.log("ispa: Webkit dosyaları zaten enjekte edildi.")
            return
        try:
            js_file_path = os.path.join(self.plugin_dir, 'inject.js')
            if not os.path.exists(js_file_path):
                logger.error(f"ispa: inject.js bulunamadı: {js_file_path}")
                return
            Millennium.add_browser_js(js_file_path)
            self._injected = True
            logger.log("ispa: Webkit dosyaları başarıyla enjekte edildi.")
        except Exception as e:
            logger.error(f'ispa: Webkit dosyaları enjekte edilemedi: {e}')

    def _load(self):
        try:
            detect_steam_install_path()
        except Exception as e:
            logger.log(f'ispa: Steam yol tespiti başarısız: {e}')
        self._inject_webkit_files()
        Millennium.ready()

    def _unload(self):
        logger.log("ispa eklentisi kaldırılıyor")
        close_global_client()
        # Reset injection flag so plugin can be re-injected if enabled again
        self._injected = False
        logger.log("ispa: Temizleme tamamlandı")

_plugin_instance = None
def get_plugin():
    global _plugin_instance
    if _plugin_instance is None:
        _plugin_instance = Plugin()
        _plugin_instance._load()
    return _plugin_instance

plugin = get_plugin()

def hasLuaForApp(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        exists = has_lua_for_app(appid)
        return json.dumps({'success': True, 'exists': exists})
    except Exception as e:
        logger.error(f'hasLuaForApp hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def addViaIspa(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.add_via_lua(appid, ['ispa'])
        return json.dumps(result)
    except Exception as e:
        logger.error(f'addViaIspa hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def GetStatus(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.get_download_status(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'GetStatus hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def RemoveViaIspa(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.remove_via_lua(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'RemoveViaIspa hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def CheckUpdates(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.check_updates(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'CheckUpdates hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def CheckDLC(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.check_dlc(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'CheckDLC hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def InstallMissingDLC(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.install_missing_dlc(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'InstallMissingDLC hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def GetFixStatus(appid: int) -> str:
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.get_fix_status(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'GetFixStatus hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def CheckFixAvailable(appid: int) -> str:
    """Fix dosyasının mevcut olup olmadığını kontrol et"""
    try:
        if not isinstance(appid, int):
            raise ValueError("appid parametresi int olmalı.")
        result = plugin.ispa_manager.check_fix_available(appid)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'CheckFixAvailable hatası {appid}: {e}')
        return json.dumps({'success': False, 'error': str(e), 'available': False})

def ApplyFix(appid: int, fix_type: str) -> str:
    try:
        if not isinstance(appid, int) or not isinstance(fix_type, str):
            raise ValueError("appid int, fix_type str olmalı.")
        result = plugin.ispa_manager.apply_fix(appid, fix_type)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'ApplyFix hatası {appid}/{fix_type}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def RemoveFix(appid: int, fix_type: str) -> str:
    try:
        if not isinstance(appid, int) or not isinstance(fix_type, str):
            raise ValueError("appid int, fix_type str olmalı.")
        result = plugin.ispa_manager.remove_fix(appid, fix_type)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'RemoveFix hatası {appid}/{fix_type}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def DownloadAndApplyFix(appid: int, fix_type: str) -> str:
    """generator.ryuu.lol'den fix indir ve uygula"""
    try:
        if not isinstance(appid, int) or not isinstance(fix_type, str):
            raise ValueError("appid int, fix_type str olmalı.")
        result = plugin.ispa_manager.download_and_apply_fix(appid, fix_type)
        return json.dumps(result)
    except Exception as e:
        logger.error(f'DownloadAndApplyFix hatası {appid}/{fix_type}: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def GetVerificationHeaders() -> str:
    """Steam doğrulama başlıklarını döndürür"""
    try:
        verification = get_steam_verification()
        if verification:
            headers = verification.get_verification_headers()
            return json.dumps({'success': True, 'headers': headers})
        else:
            return json.dumps({'success': False, 'error': 'SteamVerification başlatılamadı'})
    except Exception as e:
        logger.error(f'GetVerificationHeaders hatası: {e}')
        return json.dumps({'success': False, 'error': str(e)})

def RestartSteam() -> str:
    try:
        system = platform.system()
        logger.log(f'ispa: RestartSteam called, system={system}')
        if system == 'Windows':
            cmd_path = os.path.join(plugin.plugin_dir, 'restart_steam.cmd')
            logger.log(f'ispa: Using restart_steam.cmd at: {cmd_path}')
            if os.path.exists(cmd_path):
                try:
                    subprocess.run(['cmd', '/c', cmd_path], check=False, capture_output=True)
                    logger.log(f'ispa: restart_steam.cmd executed successfully')
                    return json.dumps({'success': True, 'message': 'Steam yeniden başlatıldı'})
                except Exception as e:
                    logger.error(f'ispa: Failed to execute restart_steam.cmd: {e}')
                    return json.dumps({'success': False, 'error': f'restart_steam.cmd çalıştırılamadı: {str(e)}'})
            else:
                logger.error(f'ispa: restart_steam.cmd not found at {cmd_path}')
                return json.dumps({'success': False, 'error': 'restart_steam.cmd bulunamadı'})
        elif system in ('Linux', 'Darwin'):
            logger.log(f'ispa: Unix system detected')
            try:
                # pkill ile steam'i kapat
                subprocess.run(['pkill', '-9', 'steam'], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                # 2 saniye bekle
                import time
                time.sleep(2)
                # Steam'i yeniden başlat
                subprocess.Popen(['steam'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                logger.log(f'ispa: Steam restarted via subprocess')
                return json.dumps({'success': True, 'message': 'Steam yeniden başlatıldı'})
            except Exception as e:
                logger.error(f'ispa: Unix restart failed: {e}')
                return json.dumps({'success': False, 'error': str(e)})
        else:
            logger.error(f'ispa: Unsupported system: {system}')
            return json.dumps({'success': False, 'error': f'Desteklenmeyen sistem: {system}'})
    except Exception as e:
        logger.error(f'RestartSteam exception: {repr(e)}')
        return json.dumps({'success': False, 'error': f'İç hata: {str(e)}'})
