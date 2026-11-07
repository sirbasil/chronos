FROM python:3.14-slim

# Create dedicated non-root chronos user and group
RUN groupadd -g 1001 chronos && \
    useradd -u 1001 -g chronos -s /bin/sh -m chronos

WORKDIR /app

# Install minimal dependencies for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy only the controller code
COPY main.py .

# Host Docker socket group permissions:
# In Docker Compose, the host socket GID is provided dynamically via group_add (${DOCKER_GID}).
# This allows the unprivileged chronos user (uid 1001) to communicate with /var/run/docker.sock
# across different host distributions (WSL gid 1001, Ubuntu gid 999, Amazon Linux gid 994)
# without rebuilding this container image.
USER chronos

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
