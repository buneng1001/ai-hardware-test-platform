from collections.abc import Callable
from queue import Queue
from threading import Event, Thread


class RunExecutor:
    """用单个工作线程按提交顺序执行本机运行记录。"""

    def __init__(self, process_run: Callable[[int, Callable[[], bool]], None]) -> None:
        self._process_run = process_run
        self._queue: Queue[int | None] = Queue()
        self._stopping = Event()
        self._worker = Thread(target=self._work, name="run-executor", daemon=True)
        self._worker.start()

    def submit(self, run_id: int) -> None:
        self._queue.put(run_id)

    def stop(self) -> None:
        self._stopping.set()
        self._queue.put(None)
        self._worker.join()

    def _work(self) -> None:
        while not self._stopping.is_set():
            run_id = self._queue.get()
            if run_id is None or self._stopping.is_set():
                return
            self._process_run(run_id, self._stopping.is_set)
