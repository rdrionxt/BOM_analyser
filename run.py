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
    # Support environment variables for cloud hosting (Render, Railway, Docker)
    port = int(os.environ.get("PORT", 8000))
    is_cloud = bool(os.environ.get("PORT") or os.environ.get("RENDER"))
    host = os.environ.get("HOST", "0.0.0.0" if is_cloud else "127.0.0.1")
    url = f"http://localhost:{port}" if host in ["0.0.0.0", "127.0.0.1"] else f"http://{host}:{port}"

    print(f"\n=======================================================")
    print(f"🚀 Turnkey PCBA Studio & Smart BOM Sourcing Engine")
    print(f"📡 Server running at: {url} (Host: {host}, Port: {port})")
    print(f"=======================================================\n")

    # Try to open the browser automatically only in local interactive mode
    if not is_cloud:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    uvicorn.run("app.main:app", host=host, port=port, reload=not is_cloud)
