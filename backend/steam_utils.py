import os
import sys
from typing import Optional
import re

# Millennium ve PluginUtils import
try:
    import Millennium
except ImportError as e:
    print(f"HATA: Millennium modülü bulunamadı: {e}")
    raise

try:
    import PluginUtils
    logger = PluginUtils.Logger()
except ImportError as e:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger('ispa.steam_utils')
    logger.error(f"PluginUtils import hatası: {e}")

if sys.platform.startswith('win'):
    try:
        import winreg
    except Exception:
        winreg = None

_steam_install_path: Optional[str] = None

def detect_steam_install_path() -> str:
    global _steam_install_path
    if _steam_install_path:
        return _steam_install_path

    path = None
    if sys.platform.startswith('win') and winreg is not None:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
                path, _ = winreg.QueryValueEx(key, 'SteamPath')
        except Exception as e:
            logger.log(f'ispa (steam_utils): Kayıt defteri araması başarısız: {e}')
            path = None

    if not path:
        try:
            path = Millennium.steam_path()
        except Exception as e:
            logger.error(f'ispa (steam_utils): Millennium steam_path() çağrısı başarısız: {e}')
            path = None

    _steam_install_path = path
    return _steam_install_path or ''

def get_steam_config_path() -> str:
    steam_path = detect_steam_install_path()
    if not steam_path:
        raise RuntimeError("Steam kurulum yolu bulunamadı")
    return os.path.join(steam_path, 'config')

def get_stplug_in_path() -> str:
    config_path = get_steam_config_path()
    stplug_path = os.path.join(config_path, 'stplug-in')
    os.makedirs(stplug_path, exist_ok=True)
    return stplug_path

def has_lua_for_app(appid: int) -> bool:
    try:
        base_path = detect_steam_install_path()
        if not base_path:
            return False
        stplug_path = os.path.join(base_path, 'config', 'stplug-in')
        lua_file = os.path.join(stplug_path, f'{appid}.lua')
        disabled_file = os.path.join(stplug_path, f'{appid}.lua.disabled')
        ispa_file = os.path.join(stplug_path, f'{appid}.ispa')
        return os.path.exists(lua_file) or os.path.exists(disabled_file) or os.path.exists(ispa_file)
    except Exception as e:
        logger.error(f'ispa (steam_utils): Uygulama {appid} için Lua betikleri kontrol edilirken hata: {e}')
        return False

def get_app_dlc_count(appid: int) -> int:
    """Steam appmanifest dosyasından DLC sayısını al"""
    try:
        steam_path = detect_steam_install_path()
        if not steam_path:
            return 0
        steamapps = os.path.join(steam_path, 'steamapps')
        manifest_file = os.path.join(steamapps, f'appmanifest_{appid}.acf')
        if not os.path.exists(manifest_file):
            return 0
        dlc_count = 0
        with open(manifest_file, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            if '"InstalledDepots"' in content:
                depot_section = content.split('"InstalledDepots"')[1]
                dlc_count = depot_section.count('"')
                dlc_count = max(0, dlc_count // 4)
        return dlc_count
    except Exception as e:
        logger.warn(f'ispa (steam_utils): DLC sayması başarısız {appid}: {e}')
        return 0

def get_app_dlc_info(appid: int) -> dict:
    """Steam appmanifest dosyasından detaylı DLC bilgisi al (yüklü vs eksik)"""
    try:
        steam_path = detect_steam_install_path()
        if not steam_path:
            return {'installed': 0, 'total': 0, 'missing': 0}
        
        steamapps = os.path.join(steam_path, 'steamapps')
        manifest_file = os.path.join(steamapps, f'appmanifest_{appid}.acf')
        manifest_checked = [manifest_file]
        manifest_found = None
        if os.path.exists(manifest_file):
            manifest_found = manifest_file
        else:
            # Eğer ana steamapps içinde yoksa, libraryfolders.vdf'de tanımlı diğer kütüphaneleri kontrol et
            lib_vdf_candidates = [os.path.join(steamapps, 'libraryfolders.vdf'), os.path.join(steamapps, 'libraryfolders.txt')]
            lib_paths = []
            for vdf in lib_vdf_candidates:
                if os.path.exists(vdf):
                    try:
                        with open(vdf, 'r', encoding='utf-8', errors='ignore') as lf:
                            data = lf.read()
                            # Basit yaklaşımla tüm tırnak içi path'leri al
                            quoted = re.findall(r'"(.*?)"', data)
                            for q in quoted:
                                # Windows path veya unix path ve steamapps içerebilenleri filtrele
                                if (':' in q or q.startswith('/')) and os.path.exists(q):
                                    lib_paths.append(q)
                    except Exception:
                        continue
            # lib_paths içinde steamapps dizinleri olabilir veya doğrudan library path olabilir
            for p in lib_paths:
                candidate = p
                if os.path.basename(p).lower() != 'steamapps':
                    candidate = os.path.join(p, 'steamapps')
                mf = os.path.join(candidate, f'appmanifest_{appid}.acf')
                manifest_checked.append(mf)
                if os.path.exists(mf):
                    manifest_found = mf
                    break
        if not manifest_found:
            # Fallback: try main steamapps one more time if nothing found
            if os.path.exists(manifest_file):
                manifest_found = manifest_file
            else:
                return {'installed': 0, 'total': 0, 'missing': 0, 'manifest_checked': manifest_checked}
        
        installed_depots = set()
        total_depots = set()
        
        # Use the discovered manifest file for parsing
        with open(manifest_found, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

            # Simple block extraction: find "InstalledDepots" and get everything until closing brace
            installed_idx = content.find('"InstalledDepots"')
            if installed_idx >= 0:
                open_idx = content.find('{', installed_idx)
                if open_idx >= 0:
                    depth = 0
                    for i in range(open_idx, len(content)):
                        if content[i] == '{':
                            depth += 1
                        elif content[i] == '}':
                            depth -= 1
                            if depth == 0:
                                installed_block = content[open_idx:i+1]
                                # Extract all quoted numbers
                                for line in installed_block.split('\n'):
                                    m = re.match(r'\s*"(\d{4,10})"', line)
                                    if m:
                                        installed_depots.add(m.group(1))
                                break

            # Same for Depots block
            depot_idx = content.find('"Depots"')
            if depot_idx >= 0:
                open_idx = content.find('{', depot_idx)
                if open_idx >= 0:
                    depth = 0
                    for i in range(open_idx, len(content)):
                        if content[i] == '{':
                            depth += 1
                        elif content[i] == '}':
                            depth -= 1
                            if depth == 0:
                                depot_block = content[open_idx:i+1]
                                # Extract all quoted numbers
                                for line in depot_block.split('\n'):
                                    m = re.match(r'\s*"(\d{4,10})"', line)
                                    if m:
                                        total_depots.add(m.group(1))
                                break

            # Fallback kaldırıldı - sadece gerçek depot pattern'leri kullanılıyor
        
        installed = len(installed_depots)
        total = len(total_depots)
        missing = max(0, total - installed)
        
        return {
            'installed': installed,
            'total': total,
            'missing': missing,
            'installed_depots': list(installed_depots),
            'total_depots': list(total_depots),
            'manifest_path': manifest_found
        }
    except Exception as e:
        logger.warn(f'ispa (steam_utils): Detaylı DLC bilgisi başarısız {appid}: {e}')
        return {'installed': 0, 'total': 0, 'missing': 0}

