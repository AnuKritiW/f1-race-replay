from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://f1:f1pass@localhost:5432/f1replay"

    model_config = {"env_file": ".env"}


settings = Settings()
