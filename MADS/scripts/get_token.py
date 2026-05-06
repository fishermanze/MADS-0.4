#!/usr/bin/env python3
"""
获取 JWT Token 用于批量实验

用法:
  python scripts/get_token.py --backend http://localhost:8080
  或者指定用户名密码:
  python scripts/get_token.py --backend http://localhost:8080 --username admin --password admin123
"""

import argparse
import sys

import httpx


async def main():
    parser = argparse.ArgumentParser(description="获取 MADS JWT Token")
    parser.add_argument("--backend", default="http://localhost:8080", help="Java 后端地址")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="admin123")
    args = parser.parse_args()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{args.backend}/api/auth/login",
            json={"username": args.username, "password": args.password},
        )
        if resp.status_code != 200:
            print(f"登录失败: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)

        data = resp.json()
        token = data.get("accessToken")
        user = data.get("user", {})

        print(f"Token:  {token}")
        print(f"用户:   {user.get('username')} ({user.get('role')})")
        print(f"有效期: {data.get('expiresInSeconds')}s")
        print()
        print("运行实验:")
        print(f"  python scripts/run_experiment.py experiments/xxx.yaml --token {token}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
