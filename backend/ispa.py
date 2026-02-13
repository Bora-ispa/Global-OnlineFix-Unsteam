import os
import zipfile
import threading
import shutil
from io import BytesIO
from typing import Dict, Any, List, Optional
from datetime import datetime

# PluginUtils import - Millennium plugin ortamında olmalı
try:
    import PluginUtils
    logger = PluginUtils.Logger()
except ImportError as e:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger('ispa')
    logger.error(f"PluginUtils import hatası - Millennium ortamında değil misiniz? {e}")

from http_client import get_global_client
from steam_utils import get_stplug_in_path, detect_steam_install_path, has_lua_for_app
import os

def GetPluginDir():
    """Eklenti dizinini al"""
    current_file = os.path.realpath(__file__)
    if current_file.endswith('/ispa.py/ispa.py') or current_file.endswith('\\ispa.py\\ispa.py'):
        current_file = current_file[:-8]
    elif current_file.endswith('/ispa.py') or current_file.endswith('\\ispa.py'):
        current_file = current_file[:-7]
    backend_dir = os.path.dirname(current_file) if current_file.endswith('ispa.py') else current_file
    return os.path.dirname(backend_dir)

def _save_lua_bytes(dest_dir: str, appid: int, content: bytes) -> str:
    os.makedirs(dest_dir, exist_ok=True)
    # Sadece .lua dosyası oluştur
    dst_lua = os.path.join(dest_dir, f"{appid}.lua")
    try:
        with open(dst_lua, "wb") as f:
            f.write(content)
        return dst_lua
    except Exception as e:
        logger.error(f"ispa: dosya yazılırken hata: {e}")
        raise

def _extract_only_target_lua_from_zip_bytes(dest_dir: str, appid: int, zip_bytes: bytes) -> str:
    # hedef olarak .ispa ararız, fakat zip içinde hâlâ .lua olabilir; bu yüzden her ikisini de kabul ederiz
    target_ispa = f"{appid}.ispa"
    target_lua = f"{appid}.lua"
    with zipfile.ZipFile(BytesIO(zip_bytes), 'r') as z:
        names = z.namelist()
        lower = [n.lower() for n in names]
        tispa = target_ispa.lower()
        tlua = target_lua.lower()
        wanted_name: Optional[str] = None
        for i, n in enumerate(lower):
            if n.endswith('/' + tispa) or n == tispa or n.endswith('/' + tlua) or n == tlua:
                wanted_name = names[i]
                break
        if not wanted_name:
            raise RuntimeError(f"Zip içinde beklenen dosya bulunamadı: {target_ispa}")
        data = z.read(wanted_name)
        return _save_lua_bytes(dest_dir, appid, data)

def _content_type_is_lua(ctype: str) -> bool:
    c = (ctype or '').split(';')[0].strip().lower()
    return c in ('text/plain', 'text/x-lua', 'application/octet-stream')

def _write_manifest(dest_dir: str, appid: int, installed_path: str) -> str:
    """Basit manifest dosyası oluşturur. Bu, eski sürümlerin aradığı <appid>_*.manifest formatına uyar."""
    try:
        name = f"{appid}_ispa.manifest"
        dst = os.path.join(dest_dir, name)
        content = {
            'appid': appid,
            'installed_path': installed_path,
            'installed_by': 'ispa',
        }
        with open(dst, 'w', encoding='utf-8') as f:
            import json
            json.dump(content, f, ensure_ascii=False, indent=2)
        return dst
    except Exception as e:
        logger.warn(f"ispa: manifest oluşturulamadı: {e}")
        return ''


class IspaManager:
    def __init__(self, backend_path: str):
        self.backend_path = backend_path
        self._download_state: Dict[int, Dict[str, Any]] = {}
        self._download_lock = threading.Lock()
        self._api_key = None
        try:
            self._migrate_dmr_markers()
        except Exception as e:
            logger.warn(f'ispa: marker migration hata: {e}')

    def set_api_key(self, api_key: str):
        self._api_key = api_key

    def get_api_key(self):
        return self._api_key

    def _set_download_state(self, appid: int, update: Dict[str, Any]) -> None:
        with self._download_lock:
            state = self._download_state.get(appid, {})
            state.update(update)
            self._download_state[appid] = state

    def _get_download_state(self, appid: int) -> Dict[str, Any]:
        with self._download_lock:
            return self._download_state.get(appid, {}).copy()

    def get_download_status(self, appid: int) -> Dict[str, Any]:
        state = self._get_download_state(appid)
        return {'success': True, 'state': state}

    def _download_backend(self, appid: int) -> None:
        try:
            self._set_download_state(appid, {
                'status': 'checking',
                'currentApi': 'ispa',
                'bytesRead': 0,
                'totalBytes': 0,
                'endpoint': 'ispa'
            })
            client = get_global_client()
            if not client:
                raise Exception("HTTP istemcisi alınamadı")
        except Exception as e:
            logger.error(f"ispa: kurulum başarısız: {e}")
            self._set_download_state(appid, {'status': 'failed', 'error': f'Kurulum başarısız: {str(e)}'})
            return

        try:
            from api_manager import APIManager
            api_manager = APIManager(self.backend_path)
            res = api_manager.get_signed_download_url(appid)
            if not res.get('success') or not res.get('url'):
                raise RuntimeError(res.get('error', 'No signed URL'))
            download_url = res['url']
        except Exception as e:
            logger.error(f"ispa: imzalı bağlantı hatası: {e}")
            self._set_download_state(appid, {'status': 'failed', 'error': f'İmzalı bağlantı hatası: {str(e)}'})
            return

        try:
            self._set_download_state(appid, {'status': 'downloading', 'endpoint': 'ispa', 'bytesRead': 0, 'totalBytes': 0})
            status, headers, body = client.raw_get(download_url)

            if status == 410:
                self._set_download_state(appid, {'status': 'failed', 'error': 'Bağlantı süresi doldu: yeniden oluşturun'}); return
            if status == 403:
                self._set_download_state(appid, {'status': 'failed', 'error': 'Erişim reddedildi / geçersiz imza'}); return
            if status == 404:
                self._set_download_state(appid, {'status': 'failed', 'error': 'Sunucuda dosya bulunamadı'}); return
            if status < 200 or status >= 300:
                self._set_download_state(appid, {'status': 'failed', 'error': f'HTTP {status}'}); return
            if not isinstance(body, (bytes, bytearray)) or len(body) == 0:
                self._set_download_state(appid, {'status': 'failed', 'error': 'Boş yanıt'}); return

            ctype = headers.get('Content-Type', '')
            clen = headers.get('Content-Length', '')
            try:
                clen_int = int(clen) if clen and str(clen).isdigit() else len(body)
            except Exception:
                clen_int = len(body)
            logger.log(f"ispa: HTTP {status}, {len(body)} bayt (CL={clen}), İçerik-Tipi={ctype}")

            self._set_download_state(appid, {'status': 'processing', 'bytesRead': len(body), 'totalBytes': clen_int, 'contentType': ctype})

            target_dir = get_stplug_in_path()
            try:
                if _content_type_is_lua(ctype):
                    dst = _save_lua_bytes(target_dir, appid, body)
                else:
                    try:
                        dst = _extract_only_target_lua_from_zip_bytes(target_dir, appid, body)
                    except zipfile.BadZipFile:
                        snippet = body[:512].lower()
                        if snippet.startswith(b'--') or b'registry' in snippet or b'steam' in snippet:
                            dst = _save_lua_bytes(target_dir, appid, body)
                        else:
                            raise
                # Sadece dosyanın kendisini kaydet (manifest yok)
                self._set_download_state(appid, {
                    'status': 'done',
                    'success': True,
                    'api': 'ispa',
                    'installedFiles': [dst],
                    'installedPath': dst
                })
                logger.log(f"ispa: Yüklendi {dst}")
            except Exception as e:
                self._set_download_state(appid, {'status': 'failed', 'error': f'Yükleme başarısız: {str(e)}'})
                logger.error(f"ispa: yükleme başarısız {appid}: {e}")

        except Exception as e:
            logger.error(f"ispa: arka uç indirme hatası: {repr(e)}")
            self._set_download_state(appid, {'status': 'failed', 'error': f'Arka uç hatası: {str(e)}'})

    def add_via_lua(self, appid: int, endpoints: Optional[List[str]] = None) -> Dict[str, Any]:
        try: appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}

        self._set_download_state(appid, {'status': 'queued', 'bytesRead': 0, 'totalBytes': 0})

        def run():
            try:
                self._download_backend(appid)
            except Exception as e:
                logger.error(f"ispa: işlenmemiş hata: {e}")
                self._set_download_state(appid, {'status': 'failed', 'error': f'Çökme: {str(e)}'})

        threading.Thread(target=run, daemon=True).start()
        return {'success': True}

    def remove_via_lua(self, appid: int) -> Dict[str, Any]:
        try: appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}

        
        try:
            stplug = get_stplug_in_path()
            removed = []
            lua_file = os.path.join(stplug, f'{appid}.lua')
            if os.path.exists(lua_file):
                os.remove(lua_file); removed.append(f'{appid}.lua')
            ispa_file = os.path.join(stplug, f'{appid}.ispa')
            if os.path.exists(ispa_file):
                os.remove(ispa_file); removed.append(f'{appid}.ispa')
            disabled = os.path.join(stplug, f'{appid}.lua.disabled')
            if os.path.exists(disabled):
                os.remove(disabled); removed.append(f'{appid}.lua.disabled')
            for name in os.listdir(stplug):
                if name.startswith(f'{appid}_') and name.endswith('.manifest'):
                    os.remove(os.path.join(stplug, name)); removed.append(name)
            if removed:
                logger.log(f"ispa: Kaldırılan dosyalar: {removed}")
                return {'success': True, 'message': f'{len(removed)} dosya kaldırıldı', 'removed_files': removed}
            return {'success': False, 'error': f'Uygulama {appid} için dosya bulunamadı'}
        except Exception as e:
            logger.error(f"ispa: kaldırma hatası {appid}: {e}")
            return {'success': False, 'error': str(e)}

    def check_updates(self, appid: int) -> Dict[str, Any]:
        try:
            appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}
        # Basit placeholder: gerçek kontrol ek entegrasyon gerektirir
        try:
            return {'success': True, 'updates_available': False, 'message': 'Güncelleme bulunamadı'}
        except Exception as e:
            logger.error(f'ispa: check_updates hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def check_dlc(self, appid: int) -> Dict[str, Any]:
        try:
            appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}
        try:
            from steam_utils import get_app_dlc_info
            dlc_info = get_app_dlc_info(appid)
            
            installed = dlc_info.get('installed', 0)
            total = dlc_info.get('total', 0)
            missing = dlc_info.get('missing', 0)
            
            if total == 0:
                return {'success': True, 'dlc_available': 0, 'message': 'Bu oyunun DLC\'si bulunmamaktadır.', 'installed': 0, 'total': 0, 'missing': 0}
            
            if missing == 0:
                return {
                    'success': True, 
                    'dlc_available': total, 
                    'message': f'{total} adet DLC kurulu',
                    'installed': installed,
                    'total': total,
                    'missing': 0
                }
            else:
                return {
                    'success': True, 
                    'dlc_available': total, 
                    'message': f'{installed} adet DLC yüklü, {missing} adet DLC eksik',
                    'installed': installed,
                    'total': total,
                    'missing': missing
                }
        except Exception as e:
            logger.error(f'ispa: check_dlc hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def get_fix_status(self, appid: int) -> Dict[str, Any]:
        """Fix durumlarını kontrol et (Steam Online, Bypass, Denuvo)"""
        try:
            appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}
        
        try:
            # Her fix'in durumunu kontrol et - backend'de state tutuğumuz için
            # şu an dummy olarak yapıyoruz, temelden storage eklenebilir
            fixes_state = {
                'steam_online': False,
                'bypass': False,
                'denuvo': False
            }
            
            # Eğer stplug-in'de fix markers varsa kontrol et
            from steam_utils import get_stplug_in_path
            stplug_path = get_stplug_in_path()
            
            # Fix marker dosyaları kontrol et
            steam_online_marker = os.path.join(stplug_path, f'{appid}_steam_online_fix')
            bypass_marker = os.path.join(stplug_path, f'{appid}_bypass_fix')
            denuvo_marker = os.path.join(stplug_path, f'{appid}_denuvo_fix')

            fixes_state['steam_online'] = os.path.exists(steam_online_marker)
            fixes_state['bypass'] = os.path.exists(bypass_marker)
            fixes_state['denuvo'] = os.path.exists(denuvo_marker)
            
            return {
                'success': True, 
                'fixes': fixes_state,
                'all_applied': all(fixes_state.values())
            }
        except Exception as e:
            logger.error(f'ispa: get_fix_status hatası {appid}: {e}')
            return {'success': False, 'error': str(e), 'fixes': {'steam_online': False, 'bypass': False, 'denuvo': False}}

    def _migrate_dmr_markers(self) -> None:
        """Eski '_dmr_fix' marker dosyalarını '_denuvo_fix' olarak yeniden adlandırır."""
        try:
            from steam_utils import get_stplug_in_path
            stplug = get_stplug_in_path()
            if not os.path.isdir(stplug):
                return
            for name in os.listdir(stplug):
                if name.endswith('_dmr_fix'):
                    src = os.path.join(stplug, name)
                    dst = os.path.join(stplug, name[:-8] + 'denuvo_fix')
                    try:
                        if not os.path.exists(dst):
                            os.rename(src, dst)
                            logger.log(f'ispa: marker taşındı {src} -> {dst}')
                        else:
                            # Eğer hedef zaten varsa, kaldırıp taşımak yerine sil
                            os.remove(src)
                            logger.log(f'ispa: kaynak marker silindi, hedef zaten var: {src}')
                    except Exception as e:
                        logger.warn(f'ispa: marker taşıma başarısız {src}: {e}')
        except Exception as e:
            logger.warn(f'ispa: marker migration başarısız: {e}')

    def apply_fix(self, appid: int, fix_type: str) -> Dict[str, Any]:
        """Fix uygulanması (marker dosyası oluştur)"""
        try:
            appid = int(appid)
            fix_type = str(fix_type).lower()
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid veya fix_type'}
        
        if fix_type not in ['steam_online', 'bypass', 'denuvo']:
            return {'success': False, 'error': 'Bilinmeyen fix tipi'}
        
        try:
            from steam_utils import get_stplug_in_path
            stplug_path = get_stplug_in_path()
            
            marker_file = os.path.join(stplug_path, f'{appid}_{fix_type}_fix')
            
            # Marker dosyasını oluştur
            with open(marker_file, 'w') as f:
                f.write(f'Fix applied: {fix_type} at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
            
            logger.log(f'ispa: {fix_type} fix applied to appid {appid}')
            return {'success': True, 'message': f'{fix_type} fix başarıyla uygulandı'}
        except Exception as e:
            logger.error(f'ispa: apply_fix hatası {appid}/{fix_type}: {e}')
            return {'success': False, 'error': str(e)}

    def download_and_apply_fix(self, appid: int, fix_type: str) -> Dict[str, Any]:
        """generator.ryuu.lol'den fix indir ve uygula"""
        try:
            appid = int(appid)
            fix_type = str(fix_type).lower()
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid veya fix_type'}
        
        if fix_type not in ['steam_online', 'bypass', 'denuvo']:
            return {'success': False, 'error': 'Bilinmeyen fix tipi'}
        
        try:
            # Fix URL'i oluştur
            fix_url = f'https://generator.ryuu.lol/fixes/{appid}.zip'
            logger.log(f'ispa: Downloading fix from {fix_url}')
            
            # HTTP client ile indir
            client = get_global_client()
            response = client.get(fix_url)
            
            if not response.get('success'):
                return {'success': False, 'error': 'Fix indirilemedi: ' + response.get('error', 'Bilinmeyen hata')}
            
            # Zip içeriğini al
            fix_data = response.get('data')
            if isinstance(fix_data, str):
                return {'success': False, 'error': 'Fix formatı hatalı'}
            
            # Zip'i çıkar
            from steam_utils import get_stplug_in_path, detect_steam_install_path
            stplug_path = get_stplug_in_path()
            steam_path = detect_steam_install_path()
            
            if not steam_path:
                return {'success': False, 'error': 'Steam yolu bulunamadı'}
            
            # Zip dosyasını geçici konuma kaydet
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp:
                tmp.write(fix_data if isinstance(fix_data, bytes) else str(fix_data).encode())
                tmp_path = tmp.name
            
            try:
                # Zip'i aç ve içeriği kontrol et
                with zipfile.ZipFile(tmp_path, 'r') as z:
                    file_list = z.namelist()
                    logger.log(f'ispa: Fix archive contains {len(file_list)} files')
                    
                    # Fix dosyalarını Steam dizinine çıkar
                    extract_path = os.path.join(steam_path, 'ispa_fixes', str(appid), fix_type)
                    os.makedirs(extract_path, exist_ok=True)
                    
                    z.extractall(extract_path)
                    logger.log(f'ispa: Fix extracted to {extract_path}')
                
                # Fix marker'ı oluştur
                marker_file = os.path.join(stplug_path, f'{appid}_{fix_type}_fix')
                with open(marker_file, 'w') as f:
                    f.write(f'Fix downloaded and applied: {fix_type} at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\nSource: {fix_url}\nExtracted to: {extract_path}')
                
                logger.log(f'ispa: {fix_type} fix downloaded and applied to appid {appid}')
                return {'success': True, 'message': f'{fix_type} fix başarıyla indirildi ve uygulandı', 'path': extract_path}
            finally:
                # Geçici dosyayı temizle
                try:
                    os.unlink(tmp_path)
                except:
                    pass
                    
        except Exception as e:
            logger.error(f'ispa: download_and_apply_fix hatası {appid}/{fix_type}: {e}')
            return {'success': False, 'error': str(e)}

    def remove_fix(self, appid: int, fix_type: str) -> Dict[str, Any]:
        """Fix kaldırılması (marker dosyasını sil)"""
        try:
            appid = int(appid)
            fix_type = str(fix_type).lower()
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid veya fix_type'}
        
        if fix_type not in ['steam_online', 'bypass', 'denuvo']:
            return {'success': False, 'error': 'Bilinmeyen fix tipi'}
        
        try:
            from steam_utils import get_stplug_in_path
            stplug_path = get_stplug_in_path()
            
            marker_file = os.path.join(stplug_path, f'{appid}_{fix_type}_fix')
            
            # Marker dosyasını sil
            if os.path.exists(marker_file):
                os.remove(marker_file)
                logger.log(f'ispa: {fix_type} fix removed from appid {appid}')
                return {'success': True, 'message': f'{fix_type} fix başarıyla kaldırıldı'}
            else:
                return {'success': True, 'message': f'{fix_type} fix zaten yüklü değil'}
        except Exception as e:
            logger.error(f'ispa: remove_fix hatası {appid}/{fix_type}: {e}')
            return {'success': False, 'error': str(e)}

    def install_missing_dlc(self, appid: int) -> Dict[str, Any]:
        """Eksik DLC'leri tespit edip, steamcmd mevcutsa indirmeyi dener. Arka planda çalışır."""
        try:
            appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}

        try:
            from steam_utils import get_app_dlc_info
            dlc_info = get_app_dlc_info(appid)
            total = dlc_info.get('total', 0)
            installed = dlc_info.get('installed', 0)
            installed_depots = set(dlc_info.get('installed_depots', []))
            total_depots = set(dlc_info.get('total_depots', []))
            missing_depots = list(total_depots - installed_depots)

            if not missing_depots:
                return {'success': True, 'message': 'Eksik içerik yok', 'installed': installed, 'total': total, 'missing': 0}

            # Set initial download state for frontend to poll
            depot_status = {str(d): 'pending' for d in missing_depots}
            self._set_download_state(appid, {
                'status': 'installing_missing_dlc',
                'currentApi': 'ispa',
                'depot_list': missing_depots,
                'depot_status': depot_status,
                'to_install': len(missing_depots),
                'installed': installed,
                'total': total,
            })

            def run_install(depots: list, appid_local: int):
                import shutil, subprocess, time, os
                steamcmd = shutil.which('steamcmd') or shutil.which('steamcmd.exe') or shutil.which('SteamCMD.exe')
                # Try common paths if not in PATH
                if not steamcmd:
                    logger.log(f'ispa: steamcmd not found in PATH, checking common locations...')
                    common_paths = [
                        'C:\\Program Files (x86)\\Steam\\steamcmd\\steamcmd.exe',
                        'C:\\steamcmd\\steamcmd.exe',
                        '/usr/games/steamcmd',
                        '/opt/steamcmd/steamcmd.sh',
                    ]
                    for p in common_paths:
                        if os.path.exists(p):
                            steamcmd = p
                            logger.log(f'ispa: Found steamcmd at fallback location: {p}')
                            break

                if not steamcmd:
                    logger.error(f'ispa: steamcmd not found in PATH or common locations')
                    self._set_download_state(appid_local, {'status': 'failed', 'error': 'steamcmd bulunamadi - kurun'})
                    return
                else:
                    logger.log(f'ispa: Using steamcmd: {steamcmd}')

                success_count = 0
                for d in depots:
                    try:
                        self._set_download_state(appid_local, {'depot_status': {str(d): 'running'}})
                        cmd = [steamcmd, '+login', 'anonymous', '+download_depot', str(appid_local), str(d), 'latest', '+quit']
                        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800)
                        if proc.returncode == 0:
                            success_count += 1
                            self._set_download_state(appid_local, {'depot_status': {str(d): 'done'}})
                        else:
                            self._set_download_state(appid_local, {'depot_status': {str(d): 'failed'}})
                    except Exception:
                        self._set_download_state(appid_local, {'depot_status': {str(d): 'failed'}})
                    time.sleep(1)

                # Mark done if any depot succeeded
                if success_count > 0:
                    self._set_download_state(appid_local, {'status': 'done'})
                else:
                    self._set_download_state(appid_local, {'status': 'failed', 'error': 'İndirme başarısız'})

            threading.Thread(target=run_install, args=(missing_depots, appid), daemon=True).start()

            return {'success': True, 'message': f'{len(missing_depots)} içerik indiriliyor...', 'installed': installed, 'total': total, 'missing': len(missing_depots)}
        except Exception as e:
            logger.error(f'ispa: install_missing_dlc hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def get_game_info(self, appid: int) -> Dict[str, Any]:
        """Oyun bilgilerini al - uyumluluk kontrolü için"""
        try:
            appid = int(appid)
        except (ValueError, TypeError):
            return {'success': False, 'error': 'Geçersiz appid'}

        try:
            # Steam API'den oyun bilgilerini al
            client = get_global_client()
            if not client:
                return {'success': False, 'error': 'HTTP istemcisi alınamadı'}

            # Steam Store API'den oyun bilgilerini al
            store_url = f'https://store.steampowered.com/api/appdetails?appids={appid}&cc=tr&l=turkish'
            response = client.get(store_url)

            if not response.get('success'):
                return {'success': False, 'error': 'Steam API yanıt vermedi'}

            data = response.get('data', {})
            if str(appid) not in data or not data[str(appid)].get('success'):
                return {'success': False, 'error': 'Oyun bulunamadı'}

            app_data = data[str(appid)]['data']

            # Önemli bilgileri çıkar
            game_info = {
                'name': app_data.get('name', 'Bilinmeyen'),
                'tags': [tag['name'] for tag in app_data.get('categories', [])] + [tag['description'] for tag in app_data.get('genres', [])],
                'specs': [spec['name'] for spec in app_data.get('pc_requirements', {}).get('minimum', '').split(', ') if spec.strip()],
                'noticesText': app_data.get('detailed_description', '') + ' ' + app_data.get('about_the_game', ''),
                'developers': app_data.get('developers', []),
                'publishers': app_data.get('publishers', []),
                'release_date': app_data.get('release_date', {}).get('date', ''),
                'is_free': app_data.get('is_free', False)
            }

            return {'success': True, 'game_info': game_info}

        except Exception as e:
            logger.error(f'ispa: get_game_info hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def detect_game_path(self, appid: int) -> Optional[str]:
        """Oyun kurulum yolunu tespit et"""
        try:
            appid = int(appid)
        except (ValueError, TypeError):
            return None

        try:
            steam_path = detect_steam_install_path()
            if not steam_path:
                return None

            # Steam kütüphane klasörlerini tara
            library_folders = os.path.join(steam_path, 'steamapps', 'libraryfolders.vdf')

            if os.path.exists(library_folders):
                with open(library_folders, 'r', encoding='utf-8') as f:
                    content = f.read()

                # Library folder'ları parse et
                import re
                folder_matches = re.findall(r'"path"\s*"([^"]*)"', content)

                for folder in folder_matches:
                    # Her library folder'da appmanifest kontrol et
                    manifest_path = os.path.join(folder, 'steamapps', f'appmanifest_{appid}.acf')
                    if os.path.exists(manifest_path):
                        # Manifest'ten installdir oku
                        with open(manifest_path, 'r', encoding='utf-8') as mf:
                            manifest_content = mf.read()
                            installdir_match = re.search(r'"installdir"\s*"([^"]*)"', manifest_content)
                            if installdir_match:
                                game_dir = os.path.join(folder, 'steamapps', 'common', installdir_match.group(1))
                                if os.path.exists(game_dir):
                                    return game_dir

            return None

        except Exception as e:
            logger.error(f'ispa: detect_game_path hatası {appid}: {e}')
            return None

    def apply_steam_online_fix(self, appid: int, game_path: str, game_info: Dict[str, Any]) -> Dict[str, Any]:
        """Steam Online fix uygula - Goldberg emulator kullanarak"""
        try:
            logger.log(f'ispa: Steam Online fix uygulanıyor - appid: {appid}, path: {game_path}')

            # Goldberg emulator araçlarını kullan
            plugin_dir = GetPluginDir()
            goldberg_path = os.path.join(plugin_dir, 'Global-OnlineFix-Unsteam-main', 'goldberg_dlls')

            if not os.path.exists(goldberg_path):
                return {'success': False, 'error': 'Goldberg emulator bulunamadı'}

            # Gerekli DLL'leri kopyala
            dll_files = ['steam_api.dll', 'steam_api64.dll']
            copied_files = []

            for dll in dll_files:
                src = os.path.join(goldberg_path, dll)
                dst = os.path.join(game_path, dll)

                if os.path.exists(src):
                    shutil.copy2(src, dst)
                    copied_files.append(dst)
                    logger.log(f'ispa: {dll} kopyalandı: {dst}')

            if copied_files:
                # Marker oluştur
                stplug_path = get_stplug_in_path()
                marker_file = os.path.join(stplug_path, f'{appid}_steam_online_fix')
                with open(marker_file, 'w') as f:
                    f.write(f'Steam Online fix applied at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\nFiles: {", ".join(copied_files)}')

                return {'success': True, 'message': f'Steam Online fix uygulandı. {len(copied_files)} dosya kopyalandı.', 'files': copied_files}
            else:
                return {'success': False, 'error': 'Uygulanacak dosya bulunamadı'}

        except Exception as e:
            logger.error(f'ispa: apply_steam_online_fix hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def apply_bypass_fix(self, appid: int, game_path: str, game_info: Dict[str, Any]) -> Dict[str, Any]:
        """Bypass fix uygula - Unsteam araçlarını kullanarak"""
        try:
            logger.log(f'ispa: Bypass fix uygulanıyor - appid: {appid}, path: {game_path}')

            plugin_dir = GetPluginDir()
            unsteam_path = os.path.join(plugin_dir, 'Global-OnlineFix-Unsteam-main', 'Unsteam')

            if not os.path.exists(unsteam_path):
                return {'success': False, 'error': 'Unsteam araçları bulunamadı'}

            # Unsteam araçlarını kopyala
            tool_files = ['unsteam.dll', 'unsteam.ini', 'winmm.dll']
            copied_files = []

            for tool in tool_files:
                src = os.path.join(unsteam_path, tool)
                dst = os.path.join(game_path, tool)

                if os.path.exists(src):
                    shutil.copy2(src, dst)
                    copied_files.append(dst)
                    logger.log(f'ispa: {tool} kopyalandı: {dst}')

            if copied_files:
                # Marker oluştur
                stplug_path = get_stplug_in_path()
                marker_file = os.path.join(stplug_path, f'{appid}_bypass_fix')
                with open(marker_file, 'w') as f:
                    f.write(f'Bypass fix applied at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\nFiles: {", ".join(copied_files)}')

                return {'success': True, 'message': f'Bypass fix uygulandı. {len(copied_files)} dosya kopyalandı.', 'files': copied_files}
            else:
                return {'success': False, 'error': 'Uygulanacak dosya bulunamadı'}

        except Exception as e:
            logger.error(f'ispa: apply_bypass_fix hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}

    def apply_denuvo_fix(self, appid: int, game_path: str, game_info: Dict[str, Any]) -> Dict[str, Any]:
        """Denuvo fix uygula - Steamless kullanarak"""
        try:
            logger.log(f'ispa: Denuvo fix uygulanıyor - appid: {appid}, path: {game_path}')

            plugin_dir = GetPluginDir()
            steamless_path = os.path.join(plugin_dir, 'Global-OnlineFix-Unsteam-main', 'steamless')

            if not os.path.exists(steamless_path):
                return {'success': False, 'error': 'Steamless bulunamadı'}

            # Oyun klasöründe exe dosyalarını bul
            exe_files = []
            for file in os.listdir(game_path):
                if file.lower().endswith('.exe'):
                    exe_files.append(os.path.join(game_path, file))

            if not exe_files:
                return {'success': False, 'error': 'Oyun klasöründe exe dosyası bulunamadı'}

            # Ana exe'yi seç (genellikle en büyük olan)
            main_exe = max(exe_files, key=lambda x: os.path.getsize(x))

            logger.log(f'ispa: Ana exe dosyası: {main_exe}')

            # Steamless ile DRM'i kaldır
            steamless_exe = os.path.join(steamless_path, 'Steamless.CLI.exe')

            if not os.path.exists(steamless_exe):
                return {'success': False, 'error': 'Steamless CLI bulunamadı'}

            # Steamless komutunu çalıştır
            import subprocess
            cmd = [steamless_exe, main_exe]
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=game_path)

            if result.returncode == 0:
                # Marker oluştur
                stplug_path = get_stplug_in_path()
                marker_file = os.path.join(stplug_path, f'{appid}_denuvo_fix')
                with open(marker_file, 'w') as f:
                    f.write(f'Denuvo fix applied at {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\nTarget: {main_exe}\nSteamless output: {result.stdout}')

                return {'success': True, 'message': f'Denuvo fix uygulandı. DRM kaldırıldı: {os.path.basename(main_exe)}', 'target': main_exe}
            else:
                return {'success': False, 'error': f'Steamless başarısız: {result.stderr}'}

        except Exception as e:
            logger.error(f'ispa: apply_denuvo_fix hatası {appid}: {e}')
            return {'success': False, 'error': str(e)}
