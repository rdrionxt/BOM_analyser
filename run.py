"""
Turnkey PCBA Studio Launcher
Runs the FastAPI server on http://localhost:8000 and opens the browser.
"""

import os
import sys
import webbrowser
import uvicorn

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    port = 8000
    host = "127.0.0.1"
    url = f"http://{host}:{port}"
    print(f"\n=======================================================")
    print(f"🚀 Turnkey PCBA Studio & Smart BOM Sourcing Engine")
    print(f"📡 Server running at: {url}")
    print(f"=======================================================\n")

    # Try to open the browser automatically
    try:
        webbrowser.open(url)
    except Exception:
        pass

    uvicorn.run("app.main:app", host=host, port=port, reload=True)
