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


class StopProgram(BaseException):
    """Raised inside the game loop when the console stops the program."""


def reset():
    global _stop_requested
    _stop_requested = False


def request_stop():
    global _stop_requested
    _stop_requested = True


def _pause(seconds=0):
    if _stop_requested:
        raise StopProgram
    if can_run_sync():
        run_sync(asyncio.sleep(seconds))
    if _stop_requested:
        raise StopProgram


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
