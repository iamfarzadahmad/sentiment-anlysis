import re
import json
import subprocess
from pathlib import Path
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# --- CONFIG ---
PROJECT_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = PROJECT_DIR / "twitter_data"
JS_FILE = PROJECT_DIR / "twitter-cli-scraper.js"
NODE_CMD = "node"  # or full path if needed, e.g. r"C:\Program Files\nodejs\node.exe"

HOST = "127.0.0.3"
PORT = 8000

app = FastAPI(title="Twitter Scraper API (FastAPI)",
              version="1.0.0",
              description="Wraps the existing Node Puppeteer scraper and serves results.")

# CORS (open; restrict if you want)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static serving for saved JSON files
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(OUTPUT_DIR)), name="files")


class ScrapeRequest(BaseModel):
    query: str = Field(..., description='Twitter search query, e.g. "$goldcoin"')
    maxTweets: int = Field(50, ge=1, le=2000, description="Max tweets to collect")


def _run_node_scraper(query: str, max_tweets: int) -> dict:
    """
    Runs: node twitter-cli-scraper.js "<query>" <max_tweets>
    Parses stdout for 'Saved to: <path>' and returns JSON contents.
    """
    if not JS_FILE.exists():
        raise HTTPException(status_code=500, detail=f"Scraper script not found: {JS_FILE}")

    # Build command with explicit args list (no shell, so $ stays literal)
    cmd = [NODE_CMD, str(JS_FILE), query, str(max_tweets)]

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(PROJECT_DIR),
            capture_output=True,
            text=True,  # keep text mode
            encoding="utf-8",  # ✅ decode as UTF-8
            errors="replace",  # ✅ avoid crashes on odd bytes/emojis
            check=False
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start Node: {e}")

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""

    if proc.returncode != 0:
        # include a bit of stdout for debugging
        snippet = stdout[-1000:]
        raise HTTPException(status_code=500, detail=f"Scraper failed (code {proc.returncode}). Stderr: {stderr}\nOut: {snippet}")

    # Find "Saved to: <path>"
    m = re.search(r"Saved to:\s*(.+)", stdout)
    if not m:
        # Fallback: pick latest file by mtime
        files = sorted(OUTPUT_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not files:
            raise HTTPException(status_code=500, detail="Scraper ran but no output file found.")
        latest = files[0]
        data = json.loads(latest.read_text(encoding="utf-8"))
        return {
            "file": latest.name,
            "path": str(latest),
            "data": data
        }

    # Normalize relative path
    saved_path = m.group(1).strip()
    p = Path(saved_path)
    if not p.is_absolute():
        p = PROJECT_DIR / p
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"Output file not found at: {p}")

    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read JSON: {e}")

    return {
        "file": p.name,
        "path": str(p),
        "data": data
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "time": datetime.utcnow().isoformat() + "Z",
        "output_dir": str(OUTPUT_DIR),
        "project_dir": str(PROJECT_DIR),
    }


@app.get("/results")
def list_results():
    files = sorted(OUTPUT_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "count": len(files),
        "files": [f.name for f in files],
        "baseUrl": "/files/"
    }


@app.get("/results/latest")
def latest_result():
    files = sorted(OUTPUT_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail="No results yet.")
    latest = files[0]
    data = json.loads(latest.read_text(encoding="utf-8"))
    return {
        "file": latest.name,
        "download": f"/files/{latest.name}",
        "data": data
    }


@app.get("/results/{filename}")
def get_result(filename: str):
    p = OUTPUT_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON: {e}")
    return {
        "file": p.name,
        "download": f"/files/{p.name}",
        "data": data
    }


@app.get("/download/{filename}")
def download_file(filename: str):
    p = OUTPUT_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(str(p), media_type="application/json", filename=p.name)


@app.post("/scrape")
def scrape(req: ScrapeRequest):
    """
    Trigger a scrape. Example body:
    {
      "query": "$goldcoin",
      "maxTweets": 50
    }
    """
    result = _run_node_scraper(req.query, req.maxTweets)
    # quick summary
    tweets = result["data"].get("tweets", [])
    summary = {
        "totalTweets": len(tweets),
        "likes": sum(int(t.get("likes", 0)) for t in tweets),
        "retweets": sum(int(t.get("retweets", 0)) for t in tweets),
        "with_images": sum(1 for t in tweets if len(t.get("images", [])) > 0),
        "verified": sum(1 for t in tweets if t.get("verified")),
    }
    return {
        "ok": True,
        "file": result["file"],
        "file_url": f"/files/{result['file']}",
        "summary": summary,
        "result": result["data"],
    }


# --- ENTRYPOINT (so you can `python app.py`) ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host=HOST, port=PORT, reload=False)
