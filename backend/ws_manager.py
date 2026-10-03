from fastapi import WebSocket
from typing import Dict, List
import logging

logger = logging.getLogger("ws_manager")
logger.setLevel(logging.INFO)

class ConnectionManager:
    def __init__(self):
        # Maps member_id to a list of active WebSocket connections
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, member_id: int):
        await websocket.accept()
        if member_id not in self.active_connections:
            self.active_connections[member_id] = []
        self.active_connections[member_id].append(websocket)
        logger.info(f"Client #{member_id} connected. Active sessions: {len(self.active_connections[member_id])}")

    def disconnect(self, websocket: WebSocket, member_id: int):
        if member_id in self.active_connections:
            if websocket in self.active_connections[member_id]:
                self.active_connections[member_id].remove(websocket)
            if not self.active_connections[member_id]:
                del self.active_connections[member_id]
                logger.info(f"All clients for #{member_id} disconnected.")

    async def send_personal_message(self, message: dict, member_id: int):
        if member_id in self.active_connections:
            for connection in self.active_connections[member_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending WS message to {member_id}: {e}")

manager = ConnectionManager()
