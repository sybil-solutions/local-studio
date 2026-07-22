ARG BASE_IMAGE=madeby561/vllm-glm52-nvfp4-nf3-hybrid:v3
FROM ${BASE_IMAGE}
COPY pyproject.toml /opt/glm52-vision/pyproject.toml
COPY src /opt/glm52-vision/src
RUN /opt/venv/bin/pip install --no-deps /opt/glm52-vision

