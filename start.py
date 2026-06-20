# -*- coding: utf-8 -*-
"""RE0choice 雷达系统启动器：安装依赖、构建前端、启动 FastAPI。"""
from __future__ import annotations

import os
import platform
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from threading import Timer

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
DIST_INDEX = FRONTEND / "dist" / "index.html"
DEFAULT_PORT = 8030
PORT_RANGE = range(DEFAULT_PORT, DEFAULT_PORT + 11)


def run(cmd: list[str], cwd: Path) -> None:
    print(f">>> {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd)


def run_npm(args: str, cwd: Path) -> None:
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if npm:
        cmd = f'"{npm}" {args}'
    else:
        cmd = f"npm {args}"
    print(f">>> {cmd}")
    subprocess.check_call(cmd, cwd=cwd, shell=True)


def has_built_frontend() -> bool:
    return DIST_INDEX.is_file()


def ensure_frontend() -> None:
    if has_built_frontend() and os.environ.get("REBUILD") != "1":
        print("[2-3/4] 前端已构建，跳过 npm（设 REBUILD=1 可强制重建）")
        return

    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        if has_built_frontend():
            print("[2-3/4] 未找到 npm，使用已有 frontend/dist")
            return
        raise RuntimeError(
            "未找到 npm，请安装 Node.js：https://nodejs.org/\n"
            "或携带 frontend/dist 目录一起分发。"
        )

    print("[2/4] 安装前端依赖...")
    if not (FRONTEND / "node_modules").is_dir():
        run_npm("install", FRONTEND)

    print("[3/4] 构建前端...")
    run_npm("run build", FRONTEND)

    if not has_built_frontend():
        raise RuntimeError("构建完成但未找到 frontend/dist/index.html")


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return False
        except OSError:
            return True


def is_our_server(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
            return r.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def find_port() -> int:
    if is_our_server(DEFAULT_PORT):
        return DEFAULT_PORT
    for port in PORT_RANGE:
        if not port_in_use(port):
            return port
    raise RuntimeError(f"端口 {DEFAULT_PORT}-{DEFAULT_PORT + 10} 均被占用")


def open_browser(port: int) -> None:
    Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()


def start_server(port: int) -> None:
    url = f"http://127.0.0.1:{port}"
    print(f"\n[4/4] 服务地址: {url}")
    print("关闭此窗口即可停止服务。\n")
    (ROOT / ".port").write_text(str(port), encoding="utf-8")
    open_browser(port)
    run(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
        BACKEND,
    )


def main() -> None:
    if sys.version_info < (3, 10):
        print("需要 Python 3.10+")
        sys.exit(1)

    if is_our_server(DEFAULT_PORT):
        url = f"http://127.0.0.1:{DEFAULT_PORT}"
        print(f"服务已在运行: {url}")
        webbrowser.open(url)
        input("按 Enter 退出...")
        return

    print("[1/4] 安装后端依赖...")
    run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"], BACKEND)

    ensure_frontend()

    port = find_port()
    if port != DEFAULT_PORT:
        print(f"提示: 端口 {DEFAULT_PORT} 被占用，改用 {port}")
    start_server(port)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"\n失败，退出码 {e.returncode}")
        input("按 Enter 退出...")
        sys.exit(e.returncode)
    except KeyboardInterrupt:
        print("\n已停止。")
    except Exception as e:
        print(f"\n错误: {e}")
        input("按 Enter 退出...")
        sys.exit(1)
