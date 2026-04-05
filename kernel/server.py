import asyncio
import json
import sys
import os

# Add project root to path so kernel package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import websockets
from kernel.executor import Executor

PORT = 9742
executor = Executor()


async def handle_message(websocket):
    async for raw in websocket:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send(json.dumps({
                "type": "error",
                "message": "Invalid JSON",
            }))
            continue

        msg_type = msg.get("type")
        code = msg.get("code", "")

        if msg_type == "parse":
            snapshot, stdout, error = executor.parse(code)

            if stdout:
                await websocket.send(json.dumps({
                    "type": "output",
                    "text": stdout,
                }))

            if error:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": error,
                }))
            elif snapshot:
                await websocket.send(json.dumps({
                    "type": "snapshot",
                    "data": snapshot.to_dict(),
                }))

        elif msg_type == "execute":
            shots = msg.get("shots", 1024)
            result, snapshot, stdout, error = executor.execute(code, shots)

            if stdout:
                await websocket.send(json.dumps({
                    "type": "output",
                    "text": stdout,
                }))

            if error:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": error,
                    "traceback": error,
                }))
            else:
                if snapshot:
                    await websocket.send(json.dumps({
                        "type": "snapshot",
                        "data": snapshot.to_dict(),
                    }))
                if result:
                    await websocket.send(json.dumps({
                        "type": "result",
                        "data": result.to_dict(),
                    }))

        else:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unknown message type: {msg_type}",
            }))


async def main():
    print(f"Nuclei kernel starting on ws://localhost:{PORT}")
    async with websockets.serve(handle_message, "localhost", PORT):
        print(f"Nuclei kernel ready on ws://localhost:{PORT}")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
