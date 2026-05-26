import PyInstaller.__main__
from pathlib import Path

base = Path(__file__).parent

icon_arg = f'--icon={base / "assets" / "icon.ico"}' if (base / 'assets' / 'icon.ico').exists() else '--console'

PyInstaller.__main__.run([
    str(base / 'main.py'),
    '--name=DouArchive',
    '--onefile',
    icon_arg,
    f'--add-data={base / "static"}:static',
    '--hidden-import=uvicorn.logging',
    '--hidden-import=uvicorn.loops',
    '--hidden-import=uvicorn.loops.auto',
    '--hidden-import=uvicorn.protocols',
    '--hidden-import=uvicorn.protocols.http',
    '--hidden-import=uvicorn.protocols.http.auto',
    '--hidden-import=uvicorn.protocols.websockets',
    '--hidden-import=uvicorn.protocols.websockets.auto',
    '--hidden-import=uvicorn.lifespan',
    '--hidden-import=uvicorn.lifespan.on',
])
