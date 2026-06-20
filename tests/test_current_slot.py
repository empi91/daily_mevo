from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.api.favourites import _current_slot

WARSAW = ZoneInfo("Europe/Warsaw")
UTC = ZoneInfo("UTC")


def test_current_slot_normal_cest() -> None:
    # UTC 10:00 Mon → Warsaw 12:00 Mon (CEST = UTC+2)
    # 2026-06-15 is a Monday
    now_utc = datetime(2026, 6, 15, 10, 0, tzinfo=UTC)
    now_warsaw = now_utc.astimezone(WARSAW)

    day_of_week, time_slot = _current_slot(now=now_warsaw)

    assert day_of_week == 0  # Monday
    assert time_slot == time(12, 0)


def test_current_slot_midnight_warsaw_day_flip() -> None:
    # UTC 22:30 Mon → Warsaw 00:30 Tue (CEST = UTC+2)
    # 2026-06-15 is a Monday; at UTC 22:30 it is already Tuesday in Warsaw
    now_utc = datetime(2026, 6, 15, 22, 30, tzinfo=UTC)
    now_warsaw = now_utc.astimezone(WARSAW)

    day_of_week, time_slot = _current_slot(now=now_warsaw)

    assert day_of_week == 1  # Tuesday
    assert time_slot == time(0, 30)
