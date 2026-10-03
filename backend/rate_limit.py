from slowapi import Limiter
from slowapi.util import get_remote_address

# Shared across main.py (employee /token) and members.py (/members/login) so both
# routers register limits against the same Limiter instance/state that main.py
# attaches to app.state.limiter.
limiter = Limiter(key_func=get_remote_address)
