"""运行模块兼容入口：聚合存储、生命周期和 HTTP 路由。"""

from app.run_lifecycle import process_run, recover_unfinished_runs  # noqa: F401
from app.run_router import router  # noqa: F401
from app.run_routes import (  # noqa: F401
    ImportedRunCommand,
    cancel_run,
    download_raw_video,
    execute_collection_task,
    get_frame_imu_alignment,
    get_run_route,
    rerun,
    review_alignment,
)
from app.run_storage import (  # noqa: F401
    create_run,
    event,
    imported_artifacts,
    is_imported_task,
    not_run_check,
    record_from_row,
    save_active_run,
    save_cancelled_evidence,
)
from app.run_storage import (
    get_run as storage_get_run,
)

# 保持原有 get_run 路由函数的模块级导出名称；内部持久化读取函数仍可由调用方使用。
get_run = get_run_route
get_run_endpoint = get_run
_get_run = storage_get_run
