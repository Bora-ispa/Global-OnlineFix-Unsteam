#!/usr/bin/env python3
"""Basit CLI test aracı: APIManager ile imzalı indirme linki isteği ve kullanılabilirlik kontrolü yapar.
Kullanım:
  python backend/test_cli.py url <appid>
  python backend/test_cli.py check <appid>
"""
import sys
import json
import os
from api_manager import APIManager

def main():
    if len(sys.argv) < 3:
        print("Kullanım: test_cli.py <url|check> <appid>")
        return
    cmd = sys.argv[1]
    try:
        appid = int(sys.argv[2])
    except Exception:
        print("Geçersiz appid")
        return
    backend_path = os.path.dirname(os.path.realpath(__file__))
    api = APIManager(backend_path)
    if cmd == 'url':
        res = api.get_signed_download_url(appid)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif cmd == 'check':
        res = api.check_availability(appid)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        print('Bilinmeyen komut')

if __name__ == '__main__':
    main()
