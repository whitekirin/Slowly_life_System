import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select, desc
from backend.database import get_session
from backend.models import PromotionDM, PromotionDMCreate, PromotionDMUpdate, PromotionFavorite, User, Member
from backend.auth import get_current_user, require_permissions
from backend.members import get_current_member

router = APIRouter(prefix="/dms", tags=["dms"])

# WebSocket Manager for Real-time DM updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Handle disconnected clients
                pass

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # We don't really expect clients to send data, just listen
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Admin API ---

@router.get("/admin", response_model=List[PromotionDM])
async def read_dms_admin(
    skip: int = 0, 
    limit: int = 100, 
    status: Optional[str] = None,
    current_user: User = Depends(require_permissions(["view_dms"])),
    session: Session = Depends(get_session)
):
    query = select(PromotionDM)
    if status:
        query = query.where(PromotionDM.status == status)
    query = query.offset(skip).limit(limit).order_by(desc(PromotionDM.created_at))
    return session.exec(query).all()

@router.post("/admin", response_model=PromotionDM)
async def create_dm(
    dm_in: PromotionDMCreate, 
    current_user: User = Depends(require_permissions(["create_dms"])),
    session: Session = Depends(get_session)
):
    dm = PromotionDM.from_orm(dm_in)
    dm.created_by = current_user.id
    session.add(dm)
    session.commit()
    session.refresh(dm)
    
    # Broadcast if published immediately
    if dm.status == "published":
        await manager.broadcast(json.dumps({"type": "NEW_DM", "data": {"id": dm.id, "title": dm.title}}))
        
    return dm

@router.patch("/admin/{dm_id}", response_model=PromotionDM)
async def update_dm(
    dm_id: int, 
    dm_in: PromotionDMUpdate, 
    current_user: User = Depends(require_permissions(["edit_dms"])),
    session: Session = Depends(get_session)
):
    dm = session.get(PromotionDM, dm_id)
    if not dm:
        raise HTTPException(status_code=404, detail="DM not found")
        
    dm_data = dm_in.dict(exclude_unset=True)
    for key, value in dm_data.items():
        setattr(dm, key, value)
        
    dm.updated_at = datetime.now()
    session.add(dm)
    session.commit()
    session.refresh(dm)
    
    # Broadcast if status changed to published or it's an update to a published DM
    if dm.status == "published":
        await manager.broadcast(json.dumps({"type": "UPDATE_DM", "data": {"id": dm.id, "title": dm.title}}))
        
    return dm

@router.delete("/admin/{dm_id}")
async def delete_dm(
    dm_id: int, 
    current_user: User = Depends(require_permissions(["edit_dms"])),
    session: Session = Depends(get_session)
):
    dm = session.get(PromotionDM, dm_id)
    if not dm:
        raise HTTPException(status_code=404, detail="DM not found")
    
    session.delete(dm)
    session.commit()
    
    await manager.broadcast(json.dumps({"type": "DELETE_DM", "data": {"id": dm_id}}))
    return {"ok": True}


# --- Member API ---

@router.get("/me", response_model=List[PromotionDM])
async def read_active_dms_for_member(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    # In a real app with Redis, we would check cache first here.
    now = datetime.now()
    query = select(PromotionDM).where(PromotionDM.status == "published")
    dms = session.exec(query.order_by(desc(PromotionDM.created_at))).all()
    
    # Filter by date and level
    valid_dms = []
    for dm in dms:
        if dm.valid_from and dm.valid_from > now:
            continue
        if dm.valid_until and dm.valid_until < now:
            continue
            
        if "all" in dm.target_levels or current_member.level in dm.target_levels:
            valid_dms.append(dm)
            
    return valid_dms

@router.post("/me/{dm_id}/view")
async def track_view(
    dm_id: int,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    dm = session.get(PromotionDM, dm_id)
    if dm:
        dm.views += 1
        session.add(dm)
        session.commit()
    return {"ok": True}

@router.post("/me/{dm_id}/click")
async def track_click(
    dm_id: int,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    dm = session.get(PromotionDM, dm_id)
    if dm:
        dm.clicks += 1
        session.add(dm)
        session.commit()
    return {"ok": True}

@router.post("/me/{dm_id}/favorite")
async def toggle_favorite(
    dm_id: int,
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    existing = session.exec(select(PromotionFavorite).where(
        PromotionFavorite.member_id == current_member.id,
        PromotionFavorite.dm_id == dm_id
    )).first()
    
    if existing:
        session.delete(existing)
        action = "removed"
    else:
        fav = PromotionFavorite(member_id=current_member.id, dm_id=dm_id)
        session.add(fav)
        action = "added"
        
    session.commit()
    return {"action": action}

@router.get("/me/favorites", response_model=List[PromotionDM])
async def get_favorites(
    current_member: Member = Depends(get_current_member),
    session: Session = Depends(get_session)
):
    favs = session.exec(select(PromotionFavorite).where(PromotionFavorite.member_id == current_member.id)).all()
    dm_ids = [f.dm_id for f in favs]
    if not dm_ids:
        return []
    dms = session.exec(select(PromotionDM).where(PromotionDM.id.in_(dm_ids))).all()
    return dms
