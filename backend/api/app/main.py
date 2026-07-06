from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, attendance, people, reports


def create_app() -> FastAPI:
    app = FastAPI(title="CAM API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    app.include_router(people.router)
    app.include_router(attendance.router)
    app.include_router(reports.router)
    app.include_router(admin.router)
    return app


app = create_app()
