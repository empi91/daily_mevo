import uuid
from collections.abc import AsyncGenerator

import structlog
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, InvalidPasswordException, UUIDIDMixin, schemas

from app.auth.db import get_user_db
from app.auth.models import User

logger = structlog.stdlib.get_logger()


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    async def validate_password(
        self,
        password: str,
        user: schemas.UC | User,
    ) -> None:
        if len(password) < 8:
            raise InvalidPasswordException(
                reason="Password should be at least 8 characters"
            )

    async def on_after_register(
        self, user: User, request: Request | None = None
    ) -> None:
        logger.info("user_registered", user_id=str(user.id), email=user.email)


async def get_user_manager(
    user_db=Depends(get_user_db),  # type: ignore[no-untyped-def]
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)
