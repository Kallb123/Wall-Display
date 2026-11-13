"""What a probe is given to work with."""

import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TextIO

from .prompt import Prompter
from .runner import Runner


@dataclass
class Context:
    runner: Runner
    prompter: Prompter
    out: TextIO  # progress lines go here
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic
    which: Callable[[str], str | None] = shutil.which

    def say(self, message: str) -> None:
        self.out.write(f"  {message}\n")
        self.out.flush()
