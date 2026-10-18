"""Shared limits and protocol constants for the Discovery kernel."""

from __future__ import annotations

PROTOCOL_VERSION = 1

# Candidate sandbox (spec 6.1)
MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
STREAM_CAP_BYTES = 64 * 1024
TRUNCATION_MARKER = "\n[output truncated at 65536 bytes]"
CANDIDATE_CPU_MIN = 1
CANDIDATE_CPU_MAX = 60
CANDIDATE_CPU_DEFAULT = 20
MAX_CALLS = 16
SANDBOX_WALL_SLACK_SECONDS = 10

# Trusted scorer (spec 6.2)
SCORER_CPU_MIN = 1
SCORER_CPU_MAX = 600
SCORER_CPU_DEFAULT = 300

# Manager (spec 6.6)
MAX_QUEUED_PER_OWNER = 64
EVALUATION_CACHE_SIZE = 512
VALID_STAGES = ("screen", "full", "confirm")
DEFAULT_STAGE = "full"
CACHE_DIR_ENV = "NUCLEI_DISCOVERY_CACHE_DIR"
ISOLATION_ENV = "NUCLEI_DISCOVERY_ISOLATION"

# Wire-level error codes
ERR_INVALID_REQUEST = "invalid_request"
ERR_INVALID_CONFIG = "invalid_config"
ERR_UNKNOWN_EVALUATOR = "unknown_evaluator"
ERR_BUSY = "discovery_busy"
