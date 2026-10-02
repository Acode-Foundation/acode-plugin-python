"""Lets ordinary blocking pygame loops run on the browser's main thread.

A ``while running: ... clock.tick(60)`` loop never returns control to the
browser, so nothing would be drawn and Acode would freeze. With JavaScript
Promise Integration (JSPI) Python can pause on an awaitable, so the calls every
game loop makes (display.flip/update, Clock.tick, time.wait/delay, event.wait)
pause briefly and let the browser draw. Those pauses are also where a running
game is stopped, since a blocking loop never reaches an ``await``.
"""

import asyncio
import time

import pygame
from pyodide.ffi import can_run_sync, run_sync

_installed = False
_stop_requested = False

# Without JSPI these calls cannot pause. An async game loop still lets the
# event loop run between frames; a blocking one never does and would freeze
# Acode, so it is stopped after a few frames without an event loop turn.
MAX_PAUSES_WITHOUT_TURN = 10
_waiting_for_turn = False
_pauses_without_turn = 0


class StopProgram(BaseException):
    """Raised inside the game loop when the console stops the program."""


class BlockingLoopError(RuntimeError):
    pass


def reset():
    global _stop_requested
    _stop_requested = False
    _event_loop_turned()


def _event_loop_turned():
    global _waiting_for_turn, _pauses_without_turn
    _waiting_for_turn = False
    _pauses_without_turn = 0


def request_stop():
    global _stop_requested
    _stop_requested = True


def _pause(seconds=0):
    if _stop_requested:
        raise StopProgram
    if can_run_sync():
        run_sync(asyncio.sleep(seconds))
    else:
        _check_not_blocking()
    if _stop_requested:
        raise StopProgram


def _check_not_blocking():
    global _waiting_for_turn, _pauses_without_turn
    if not _waiting_for_turn:
        _waiting_for_turn = True
        asyncio.get_event_loop().call_soon(_event_loop_turned)
        return
    _pauses_without_turn += 1
    if _pauses_without_turn >= MAX_PAUSES_WITHOUT_TURN:
        raise BlockingLoopError(
            "This WebView cannot pause Python (no JSPI support), so the game "
            "loop must be async: add `await asyncio.sleep(0)` each frame."
        )


def install():
    global _installed
    if _installed:
        return
    _installed = True

    display = pygame.display
    original_flip = display.flip
    original_update = display.update

    def flip():
        original_flip()
        _pause()

    def update(*args, **kwargs):
        original_update(*args, **kwargs)
        _pause()

    display.flip = flip
    display.update = update

    original_clock = pygame.time.Clock

    class Clock:
        """pygame.time.Clock whose tick() waits without blocking the page."""

        def __init__(self):
            self._clock = original_clock()
            self._last = time.perf_counter()

        def tick(self, framerate=0):
            if framerate:
                delay = 1 / framerate - (time.perf_counter() - self._last)
                _pause(max(delay, 0))
            self._last = time.perf_counter()
            return self._clock.tick()

        tick_busy_loop = tick

        def __getattr__(self, name):
            return getattr(self._clock, name)

    pygame.time.Clock = Clock
    if hasattr(pygame, "Clock"):
        pygame.Clock = Clock

    def wait(milliseconds):
        start = time.perf_counter()
        _pause(milliseconds / 1000)
        return int((time.perf_counter() - start) * 1000)

    pygame.time.wait = wait
    pygame.time.delay = wait

    original_poll = pygame.event.poll

    def event_wait(timeout=0):
        start = time.perf_counter()
        while True:
            event = original_poll()
            if event.type != pygame.NOEVENT:
                return event
            if timeout and (time.perf_counter() - start) * 1000 >= timeout:
                return event
            _pause(0.01)

    pygame.event.wait = event_wait
